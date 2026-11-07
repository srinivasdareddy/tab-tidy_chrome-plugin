import { groupFinderTabs, filterFinderTabs } from './tab-finder.js';

export function initTabFinder(browser) {
  const byId = id => document.getElementById(id);
  const dialog = byId('tab-finder');
  const domains = byId('finder-domains');
  const list = byId('finder-tabs');
  const filter = byId('finder-filter');
  const filterWrap = byId('finder-filter-wrap');
  const toggle = byId('finder-filter-toggle');
  const status = byId('finder-status');
  let groups = [];
  let domain = null;
  let anchor;
  let anchorPromise;
  let initialized = false;
  let version = 0;
  let opening = 0;
  let refreshTimer;
  let announceTimer;
  let activating = false;

  function make(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function announce(text, error = false) {
    clearTimeout(announceTimer);
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function render() {
    const focused = document.activeElement;
    const tabFocus = focused?.dataset.finderTab;
    const domainFocus = focused?.dataset.finderDomain;
    const listScroll = list.scrollTop;
    const domainScroll = domains.scrollTop;
    const all = groups.flatMap(group => group.tabs);
    const visible = filterFinderTabs(groups, domain, filter.value);
    const windowIds = [...new Set(all.map(tab => tab.windowId))];
    const otherWindows = windowIds.filter(id => id !== anchor?.windowId);
    domains.replaceChildren();
    for (const group of [{ domain: null, tabs: all }, ...groups]) {
      const button = make('button', 'finder-domain');
      button.type = 'button';
      button.dataset.finderDomain = group.domain ?? '';
      button.setAttribute('aria-pressed', String(group.domain === domain));
      button.append(make('span', 'finder-domain-name', group.domain ?? 'All domains'), make('span', 'finder-domain-count', group.tabs.length));
      button.addEventListener('click', () => {
        domain = group.domain;
        render();
        domains.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
        list.scrollTop = 0;
        announce(`${filterFinderTabs(groups, domain, filter.value).length} titles in ${domain ?? 'all domains'}.`);
      });
      domains.append(button);
    }
    byId('finder-domain-title').textContent = domain ?? 'All domains';
    byId('finder-filter-label').textContent = domain ? `Filter titles in ${domain}` : 'Filter all open tabs';
    byId('finder-count').textContent = `${visible.length} tab${visible.length === 1 ? '' : 's'}`;
    byId('finder-empty').hidden = visible.length > 0;
    byId('finder-empty').textContent = filter.value.trim() ? 'No matching titles. Clear the filter or choose another domain.' : 'No open tabs to show.';
    list.replaceChildren();
    for (const tab of visible) {
      const button = make('button', 'finder-tab');
      button.type = 'button';
      button.dataset.finderTab = tab.id;
      button.disabled = activating;
      const current = tab.id === anchor?.id;
      if (current) button.setAttribute('aria-current', 'page');
      const title = make('span', 'finder-tab-title', tab.title);
      const url = make('span', 'finder-tab-url', tab.url || 'URL unavailable');
      const meta = [tab.windowId === anchor?.windowId ? 'This window' : `Window ${otherWindows.indexOf(tab.windowId) + 2}`];
      if (current) meta.push('Current tab');
      if (tab.incognito) meta.push('Private');
      if (tab.pinned) meta.push('Pinned');
      if (tab.audible) meta.push('Playing audio');
      if (tab.status === 'loading') meta.push('Loading');
      const detail = make('span', 'finder-tab-meta', ` · ${meta.join(' · ')}`);
      const info = make('span', 'finder-tab-info');
      info.append(title, url, detail);
      const arrow = make('span', 'finder-tab-arrow', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(info, arrow);
      button.addEventListener('click', () => select(tab.id));
      list.append(button);
    }
    // Live events replace rows; retain the user's position and keyboard focus.
    const restored = tabFocus !== undefined ? [...list.children].find(node => node.dataset.finderTab === tabFocus)
      : domainFocus !== undefined ? [...domains.children].find(node => node.dataset.finderDomain === domainFocus) : null;
    if (restored) restored.focus({ preventScroll: true });
    else if (tabFocus !== undefined || domainFocus !== undefined) domains.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    list.scrollTop = listScroll;
    domains.scrollTop = domainScroll;
  }

  async function refresh() {
    const scan = ++version;
    try {
      const [tabs, [current]] = await Promise.all([browser.tabs.query({}), anchorPromise]);
      if (!dialog.open || scan !== version) return;
      if (!initialized) anchor = current;
      else anchor = tabs.find(tab => tab.active && tab.windowId === anchor?.windowId) ?? anchor;
      groups = groupFinderTabs(tabs, browser.runtime.getURL(''));
      if (!initialized) {
        domain = null;
        initialized = true;
      } else if (domain !== null && !groups.some(group => group.domain === domain)) domain = null;
      render();
      if (!status.classList.contains('error')) announce(`${filterFinderTabs(groups, domain, filter.value).length} titles · Click a title to switch.`);
    } catch {
      if (dialog.open && scan === version) announce('Couldn’t read tabs. Use Refresh to try again.', true);
    }
  }

  async function select(tabId) {
    if (activating) return;
    const selectedOpening = opening;
    activating = true;
    render();
    announce('Switching to your tab…');
    try {
      const response = await browser.runtime.sendMessage({ type: 'focus-tab', tabId });
      if (!response?.result?.focused) throw new Error('Switch failed');
      if (dialog.open && selectedOpening === opening) dialog.close();
    } catch {
      if (dialog.open && selectedOpening === opening) {
        activating = false;
        await refresh();
        if (selectedOpening === opening) {
          announce('Couldn’t switch tabs. It may have closed. Choose a title to try again.', true);
          const retry = [...list.children].find(node => node.dataset.finderTab === String(tabId)) ?? list.querySelector('button') ?? byId('finder-refresh');
          retry.focus();
        }
      }
    } finally {
      if (selectedOpening === opening) activating = false;
    }
  }

  byId('open-tab-finder').addEventListener('click', () => {
    if (dialog.open) return;
    ++opening;
    initialized = false;
    activating = false;
    groups = [];
    domain = null;
    filter.value = '';
    filterWrap.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('finder-open');
    dialog.showModal();
    render();
    filter.focus();
    announce('Reading open tabs…');
    anchorPromise = browser.tabs.query({ active: true, currentWindow: true });
    void refresh();
  });
  dialog.addEventListener('close', () => {
    ++version;
    ++opening;
    clearTimeout(refreshTimer);
    clearTimeout(announceTimer);
    document.documentElement.classList.remove('finder-open');
  });
  toggle.addEventListener('click', () => {
    filterWrap.hidden = !filterWrap.hidden;
    toggle.setAttribute('aria-expanded', String(!filterWrap.hidden));
    if (!filterWrap.hidden) filter.focus();
    else {
      filter.value = '';
      render();
      announce(`${filterFinderTabs(groups, domain).length} titles · Click a title to switch.`);
    }
  });
  filter.addEventListener('input', () => {
    render();
    list.scrollTop = 0;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => announce(`${filterFinderTabs(groups, domain, filter.value).length} matching titles.`), 250);
  });
  byId('finder-refresh').addEventListener('click', () => {
    announce('Reading open tabs…');
    if (!initialized) anchorPromise = browser.tabs.query({ active: true, currentWindow: true });
    void refresh();
  });
  dialog.addEventListener('keydown', event => {
    const inDomains = domains.contains(event.target);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (!inDomains && !list.contains(event.target) && event.target !== filter)) return;
    if (event.target === filter && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const rows = [...(inDomains ? domains : list).querySelectorAll('button:not(:disabled)')];
    if (!rows.length) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    if (inDomains) {
      rows[next].click();
      domains.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    } else rows[next].focus();
  });
  const schedule = () => {
    if (!dialog.open) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 120);
  };
  for (const event of ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onMoved', 'onAttached', 'onDetached']) browser.tabs[event].addListener(schedule);
}
