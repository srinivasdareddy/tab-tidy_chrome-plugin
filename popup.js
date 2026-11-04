import { findDuplicateGroups } from './duplicates.js';
import { getUndoTabs } from './cleanup.js';
import { parkableTabs, getParkedTabs } from './parking.js';

const elements = Object.fromEntries(['refresh', 'arrange-domains', 'auto-arrange-domains', 'duplicate-count', 'summary-title', 'summary-detail', 'group-count', 'groups', 'empty', 'status', 'close-all', 'close-count', 'smart-matching', 'match-description', 'undo-cleanup', 'undo-count', 'duplicate-shield', 'shield-result', 'show-duplicates', 'show-parking', 'duplicates-panel', 'parking-panel', 'duplicate-actions', 'footer-hint', 'parked-count', 'park-search', 'park-age', 'park-inactive', 'shelf-count', 'shelf-results', 'parked-list', 'parking-empty', 'parkable-count', 'parkable-list'].map(id => [id, document.getElementById(id)]));
let groups = [];
let parkedEntries = [];
let openParkingTabs = [];
let visibleParked = 5;
let visibleOpen = 5;
let disclosureId = 0;
const expandedUrls = new Set();
let parkingView = false;
let smartMatching = false;
let busy = false;
let scanVersion = 0;
let refreshTimer;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function message(text, error = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('error', error);
}

function showView(parking) {
  parkingView = parking;
  elements['show-duplicates'].setAttribute('aria-pressed', String(!parking));
  elements['show-parking'].setAttribute('aria-pressed', String(parking));
  elements['duplicates-panel'].hidden = parking;
  elements['parking-panel'].hidden = !parking;
  elements['duplicate-actions'].hidden = parking;
  elements['footer-hint'].textContent = parking ? 'Saved on this device. Reopening removes a link from the shelf.' : 'Pinned copy kept first, then an active copy.';
  updateDisclosures();
}

function updateDisclosures() {
  requestAnimationFrame(() => {
    for (const button of document.querySelectorAll('.url-disclosure')) {
      const text = document.getElementById(button.getAttribute('aria-controls'));
      if (text?.getClientRects().length) button.hidden = button.getAttribute('aria-expanded') !== 'true' && text.scrollHeight <= text.clientHeight + 1;
    }
  });
}

function addUrl(info, value) {
  const url = make('p', 'site-url collapsible-url', value);
  url.id = `url-${++disclosureId}`;
  url.title = value;
  const more = make('button', 'text-button url-disclosure');
  more.type = 'button';
  more.hidden = true;
  more.disabled = busy;
  more.setAttribute('aria-controls', url.id);
  function setExpanded(expanded) {
    url.classList.toggle('expanded', expanded);
    more.setAttribute('aria-expanded', String(expanded));
    more.textContent = expanded ? 'Show less' : 'Show more';
  }
  setExpanded(expandedUrls.has(value));
  more.addEventListener('click', () => {
    const expanded = more.getAttribute('aria-expanded') !== 'true';
    if (expanded) expandedUrls.add(value); else expandedUrls.delete(value);
    setExpanded(expanded);
  });
  info.append(url, more);
}

function setMoreButton(id, shown, total) {
  const button = document.getElementById(id);
  const remaining = Math.max(0, total - shown);
  button.hidden = remaining === 0;
  button.disabled = busy;
  button.textContent = `Show ${Math.min(5, remaining)} more (${remaining} remaining)`;
}

function renderOpenParkingTabs() {
  elements['parkable-list'].replaceChildren(...openParkingTabs.slice(0, visibleOpen).map(tab => shelfRow(tab, true)));
  setMoreButton('show-more-open', visibleOpen, openParkingTabs.length);
  updateDisclosures();
}

function disableControls() {
  document.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
}

function unlockControls() {
  document.querySelectorAll('input, select').forEach(control => { control.disabled = false; });
  for (const id of ['refresh', 'show-duplicates', 'show-parking']) elements[id].disabled = false;
}

function shelfRow(entry, openTab = false) {
  const row = make('article', 'parked-row');
  const info = make('div', 'site-info');
  const title = make('h3', 'site-title', entry.title || entry.url);
  title.title = entry.title || entry.url;
  info.append(title);
  addUrl(info, entry.url);
  if (!openTab) info.append(make('p', 'parked-meta', `${entry.incognito ? 'Private · ' : ''}Parked ${new Date(entry.parkedAt).toLocaleDateString()}`));
  const actions = make('div', 'park-actions');
  const primary = make('button', 'group-close', openTab ? 'Park' : 'Reopen');
  primary.type = 'button';
  primary.disabled = busy;
  primary.setAttribute('aria-label', `${openTab ? 'Park' : 'Reopen'} ${entry.title || entry.url}`);
  primary.addEventListener('click', () => runAction(openTab ? 'park-tabs' : 'reopen-parked', openTab ? [entry] : [], { id: entry.id }));
  actions.append(primary);
  if (!openTab) {
    const remove = make('button', 'delete-parked', 'Delete');
    remove.type = 'button';
    remove.disabled = busy;
    remove.setAttribute('aria-label', `Delete saved link ${entry.title || entry.url}`);
    remove.addEventListener('click', () => runAction('delete-parked', [], { id: entry.id }));
    actions.append(remove);
  }
  row.append(info, actions);
  return row;
}

function renderShelf() {
  const query = elements['park-search'].value.trim().toLowerCase();
  const filtered = parkedEntries.filter(entry => `${entry.title}\n${entry.url}`.toLowerCase().includes(query));
  elements['parked-list'].replaceChildren(...filtered.slice(0, visibleParked).map(entry => shelfRow(entry)));
  setMoreButton('show-more-parked', visibleParked, filtered.length);
  elements['shelf-count'].textContent = parkedEntries.length;
  elements['shelf-results'].textContent = query ? `${filtered.length} found` : '';
  elements['parking-empty'].hidden = filtered.length > 0;
  elements['parking-empty'].textContent = query ? 'No parked tabs match your search.' : 'Your shelf is empty. Park a tab from the list below.';
  updateDisclosures();
}

function tabRow(tab, kept) {
  const row = make('div', 'tab-row');
  const label = `${tab.active ? 'Active · ' : ''}${tab.pinned ? 'Pinned · ' : ''}Window ${tab.windowId} · Tab ${tab.index + 1}`;
  const description = make('span', 'tab-label', label);
  if (smartMatching) description.append(make('span', 'tab-url', tab.url));
  row.append(make('span', 'row-dot'), description);
  row.title = `${tab.title || 'Tab'}\n${tab.url}`;
  if (kept) {
    row.append(make('span', 'kept-label', 'KEEPING'));
  } else {
    const close = make('button', 'close-tab', 'Close');
    close.type = 'button';
    close.disabled = busy;
    close.append(make('span', '', '×'));
    close.lastChild.setAttribute('aria-hidden', 'true');
    close.setAttribute('aria-label', `Close duplicate: ${tab.title || tab.url}, ${label}`);
    close.title = `Close this duplicate in window ${tab.windowId}`;
    close.addEventListener('click', () => runClose([tab]));
    row.append(close);
  }
  return row;
}

function render(tabs, lastCleanup, settings, shieldBlockedCount) {
  groups = findDuplicateGroups(tabs, { smartMatching });
  const count = groups.reduce((sum, group) => sum + group.duplicates.length, 0);
  elements['duplicate-count'].textContent = count;
  elements['summary-title'].textContent = count ? `duplicate tab${count === 1 ? '' : 's'} found` : 'All clear.';
  elements['summary-detail'].textContent = count ? `Across ${plural(groups.length, 'URL')} · ${plural(tabs.length, 'tab')} checked` : `${plural(tabs.length, 'tab')} checked across all windows`;
  elements['group-count'].textContent = groups.length;
  elements['close-count'].textContent = count;
  elements['close-all'].disabled = busy || count === 0;
  const openIds = new Set(tabs.map(tab => tab.id));
  const undoCount = lastCleanup.filter(tab => !openIds.has(tab.id)).length;
  elements['undo-cleanup'].hidden = undoCount === 0;
  elements['undo-cleanup'].disabled = busy;
  elements['undo-count'].textContent = undoCount;
  elements['smart-matching'].checked = smartMatching;
  elements['duplicate-shield'].checked = settings.shieldEnabled === true;
  elements['auto-arrange-domains'].checked = settings.autoArrangeDomains !== false;
  elements['arrange-domains'].disabled = busy;
  elements['shield-result'].textContent = settings.shieldEnabled ? `${plural(shieldBlockedCount, 'duplicate')} caught this session.` : 'Off by default.';
  elements['match-description'].textContent = smartMatching ? 'Tracking tags ignored' : 'Exact matches only';
  elements.empty.hidden = count > 0;
  elements.groups.replaceChildren();
  for (const group of groups) {
    let hostname;
    try { hostname = new URL(group.url).hostname || new URL(group.url).protocol; } catch { hostname = group.url; }
    const article = make('article', 'group');
    const header = make('div', 'group-header');
    const info = make('div', 'site-info');
    const title = make('h3', 'site-title', group.keeper.title || hostname);
    title.title = group.keeper.title || hostname;
    info.append(title);
    addUrl(info, group.url);
    const close = make('button', 'group-close', `Close ${group.duplicates.length}`);
    close.type = 'button';
    close.disabled = busy;
    close.setAttribute('aria-label', `Close ${plural(group.duplicates.length, 'duplicate')} of ${group.url}`);
    close.title = 'Close duplicates of this URL; keep one copy';
    close.addEventListener('click', () => runClose(group.duplicates));
    const mark = make('span', 'site-mark', hostname.replace(/^www\./, '').slice(0, 1).toUpperCase());
    mark.setAttribute('aria-hidden', 'true');
    header.append(mark, info, close);
    article.append(header, tabRow(group.keeper, true), ...group.duplicates.map(tab => tabRow(tab, false)));
    elements.groups.append(article);
  }
  const age = [0, 24, 48].includes(settings.parkInactiveHours) ? settings.parkInactiveHours : 48;
  elements['park-age'].value = age;
  const inactive = parkableTabs(tabs);
  openParkingTabs = inactive;
  const stale = parkableTabs(tabs, age);
  elements['park-inactive'].disabled = busy || stale.length === 0;
  elements['park-inactive'].textContent = `Park ${stale.length} inactive`;
  elements['parkable-count'].textContent = inactive.length;
  elements['parked-count'].textContent = parkedEntries.length;
  renderOpenParkingTabs();
  renderShelf();
}

async function scan(announce = false) {
  const version = ++scanVersion;
  try {
    const [tabs, settings, shelf, { shieldBlockedCount = 0 }] = await Promise.all([
      chrome.tabs.query({}), chrome.storage.local.get(['smartMatching', 'shieldEnabled', 'parkInactiveHours', 'autoArrangeDomains']),
      getParkedTabs(chrome), chrome.storage.session.get('shieldBlockedCount'),
    ]);
    const lastCleanup = await getUndoTabs(chrome, tabs);
    if (version !== scanVersion) return false;
    smartMatching = settings.smartMatching === true;
    parkedEntries = shelf;
    render(tabs, lastCleanup, settings, shieldBlockedCount);
    if (announce) message(smartMatching ? 'Tracking tags ignored. Page parameters and #fragments still matter.' : 'Up to date. Full URLs, including query strings and #fragments, must match.');
    return true;
  } catch {
    if (version !== scanVersion) return false;
    elements['close-all'].disabled = true;
    elements['undo-cleanup'].disabled = true;
    elements['park-inactive'].disabled = true;
    elements['arrange-domains'].disabled = true;
    elements['summary-title'].textContent = 'Couldn’t scan tabs.';
    message('Unable to read tabs. Click the refresh button to try again.', true);
    return false;
  }
}

async function runAction(type, selected = [], extra = {}) {
  if (busy) return;
  busy = true;
  ++scanVersion; // An in-flight scan must not replace controls during a close.
  const restoreFocus = document.activeElement?.tagName === 'BUTTON';
  disableControls();
  const arranging = type === 'arrange-domains';
  const undo = type === 'undo-cleanup';
  const parking = ['park-tabs', 'park-inactive', 'reopen-parked', 'delete-parked'].includes(type);
  message(arranging ? 'Placing domain siblings together…' : parking ? 'Updating parking lot…' : undo ? 'Restoring last cleanup…' : `Closing ${plural(selected.length, 'duplicate')}…`);
  let result;
  try {
    const response = await chrome.runtime.sendMessage({ type, tabs: selected, ...extra });
    if (!response?.result) throw new Error(response?.error || 'Cleanup unavailable');
    result = response.result;
  } catch (error) {
    message(error.message || 'Action interrupted. Refresh to check what remains.', true);
  } finally {
    busy = false;
    const refreshed = await scan();
    unlockControls();
    if (refreshed && result) {
      const text = arranging ? (result.moved ? `Moved ${plural(result.moved, 'tab')}. Domain siblings are together.` : 'Domain siblings are already together. Pinned tabs and existing groups stay in place.') : type.startsWith('park-') ? `Parked ${plural(result.parked, 'tab')}.` : type === 'reopen-parked' ? `Reopened ${plural(result.reopened, 'tab')}.` : type === 'delete-parked' ? `Deleted ${plural(result.deleted, 'saved link')}.` : undo ? `Restored ${plural(result.restored, 'tab')}.` : `Closed ${plural(result.closed, 'duplicate tab')}.`;
      const parts = [text];
      if (result.skipped) parts.push(`${result.skipped} skipped because tabs changed.`);
      if (result.failed) parts.push(`${result.failed} could not be completed. Try again.`);
      message(parts.join(' '), result.failed > 0);
    }
    if (restoreFocus) (arranging ? elements['arrange-domains'] : parkingView ? elements['park-search'] : elements['close-all'].disabled ? elements.refresh : elements['close-all']).focus();
  }
}

async function runClose(selected) { await runAction('close-duplicates', selected); }

async function savePreference(key, value) {
  if (busy) return;
  busy = true;
  ++scanVersion;
  disableControls();
  let saved = false;
  try {
    if (key === 'shieldEnabled') {
      const response = await chrome.runtime.sendMessage({ type: 'set-shield', enabled: value });
      if (!response?.result) throw new Error('Could not update Shield');
    } else await chrome.storage.local.set({ [key]: value });
    saved = true;
  } catch {
    elements['smart-matching'].checked = smartMatching;
    message('Could not save preference. Try again.', true);
  } finally {
    busy = false;
    await scan(saved && key !== 'autoArrangeDomains');
    if (saved && key === 'autoArrangeDomains') message(value ? 'Automatic domain siblings enabled. Arranging tabs now.' : 'Automatic arrangement off. Use Group by domain whenever you want.');
    unlockControls();
  }
}

function scheduleScan() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { if (!busy) await scan(); }, 120);
}

elements.refresh.addEventListener('click', () => scan(true));
elements['arrange-domains'].addEventListener('click', () => runAction('arrange-domains'));
elements['auto-arrange-domains'].addEventListener('change', () => savePreference('autoArrangeDomains', elements['auto-arrange-domains'].checked));
elements['close-all'].addEventListener('click', () => runClose(groups.flatMap(group => group.duplicates)));
elements['undo-cleanup'].addEventListener('click', () => runAction('undo-cleanup'));
elements['smart-matching'].addEventListener('change', () => savePreference('smartMatching', elements['smart-matching'].checked));
elements['duplicate-shield'].addEventListener('change', () => savePreference('shieldEnabled', elements['duplicate-shield'].checked));
elements['park-age'].addEventListener('change', () => savePreference('parkInactiveHours', Number(elements['park-age'].value)));
elements['show-duplicates'].addEventListener('click', () => showView(false));
elements['show-parking'].addEventListener('click', () => showView(true));
elements['park-search'].addEventListener('input', () => { visibleParked = 5; renderShelf(); });
document.getElementById('show-more-parked').addEventListener('click', () => { visibleParked += 5; renderShelf(); });
document.getElementById('show-more-open').addEventListener('click', () => { visibleOpen += 5; renderOpenParkingTabs(); });
document.getElementById('open-tabs-details').addEventListener('toggle', updateDisclosures);
elements['park-inactive'].addEventListener('click', () => runAction('park-inactive'));
chrome.storage.onChanged.addListener((changes, area) => {
  const relevant = area === 'local' ? ['smartMatching', 'shieldEnabled', 'parkInactiveHours', 'autoArrangeDomains', 'parkedTabs'] : ['lastCleanup', 'pendingCleanup', 'parkedPrivateTabs', 'shieldBlockedCount'];
  if (relevant.some(key => key in changes)) scheduleScan();
});
chrome.tabs.onCreated.addListener(scheduleScan);
chrome.tabs.onRemoved.addListener(scheduleScan);
chrome.tabs.onUpdated.addListener(scheduleScan);
chrome.tabs.onActivated.addListener(scheduleScan);
chrome.tabs.onMoved.addListener(scheduleScan);
chrome.tabs.onAttached.addListener(scheduleScan);
await scan(true);
