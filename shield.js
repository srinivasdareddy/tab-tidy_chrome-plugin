import { matchingUrl } from './duplicates.js';

const webUrl = url => typeof url === 'string' && /^https?:\/\//i.test(url);
const blankUrl = url => !url || ['about:blank', 'chrome://newtab/', 'chrome://new-tab-page/'].includes(url);

async function processTab(browser, id, created) {
  const settings = await browser.storage.local.get(['shieldEnabled', 'smartMatching']);
  if (settings.shieldEnabled !== true) return { blocked: false };
  const { shieldCandidates = {}, shieldBypass = [], shieldBlockedCount = 0 } = await browser.storage.session.get(['shieldCandidates', 'shieldBypass', 'shieldBlockedCount']);
  const tabs = await browser.tabs.query({});
  const current = tabs.find(tab => tab.id === id);
  const openIds = new Set(tabs.map(tab => String(tab.id)));
  for (const key of Object.keys(shieldCandidates)) if (!openIds.has(key)) delete shieldCandidates[key];
  let bypass = shieldBypass.filter(key => openIds.has(String(key)));
  let blocked = false;
  if (created && current && !shieldCandidates[id]) shieldCandidates[id] = { startedAt: null };
  try {
    if (!current) { delete shieldCandidates[id]; return { blocked }; }
    if (bypass.includes(id)) {
      delete shieldCandidates[id];
      if (!current.pendingUrl && current.status === 'complete') bypass = bypass.filter(key => key !== id);
      return { blocked };
    }
    if (!shieldCandidates[id]) return { blocked };
    if (current.pinned || current.audible || current.discarded) { delete shieldCandidates[id]; return { blocked }; }
    const url = current.pendingUrl || current.url;
    if (!webUrl(url)) {
      if (!blankUrl(url)) delete shieldCandidates[id];
      return { blocked };
    }
    shieldCandidates[id].startedAt ??= Date.now();
    // A slow first load may already be in use; stop interfering after 30 seconds.
    if (Date.now() - shieldCandidates[id].startedAt > 30000) { delete shieldCandidates[id]; return { blocked }; }
    const others = tabs.filter(tab => tab.id !== id && !tab.pendingUrl && webUrl(tab.url) &&
      Boolean(tab.incognito) === Boolean(current.incognito) && matchingUrl(tab.url, settings) === matchingUrl(url, settings));
    others.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.active) - Number(a.active) || a.id - b.id);
    const target = others[0];
    if (!target) {
      if (!current.pendingUrl && current.status === 'complete') delete shieldCandidates[id];
      return { blocked };
    }
    delete shieldCandidates[id];
    try {
      // Focus first: failure must leave the new tab open.
      await browser.tabs.update(target.id, { active: true });
      if (current.active) await browser.windows.update(target.windowId, { focused: true });
      const [fresh, kept] = await Promise.all([browser.tabs.get(id), browser.tabs.get(target.id)]);
      if (fresh.pinned || fresh.audible || (fresh.pendingUrl || fresh.url) !== url || kept.pendingUrl ||
          Boolean(fresh.incognito) !== Boolean(kept.incognito) || matchingUrl(kept.url, settings) !== matchingUrl(url, settings)) return { blocked };
      await browser.tabs.remove(id);
      blocked = true;
      await browser.storage.session.set({ shieldBlockedCount: shieldBlockedCount + 1 });
    } catch { /* The user may have closed or navigated either tab; keep what remains. */ }
    return { blocked };
  } finally {
    await browser.storage.session.set({ shieldCandidates, shieldBypass: bypass.filter(key => key !== id || !blocked) });
  }
}

// Call these operations under the shared tab-operation lock in the worker.
export async function shieldCreated(browser, tab) { return processTab(browser, tab.id, true); }
export async function shieldUpdated(browser, id) { return processTab(browser, id, false); }

export async function forgetShieldTab(browser, id) {
  const { shieldCandidates = {}, shieldBypass = [] } = await browser.storage.session.get(['shieldCandidates', 'shieldBypass']);
  if (!(id in shieldCandidates) && !shieldBypass.includes(id)) return;
  delete shieldCandidates[id];
  await browser.storage.session.set({ shieldCandidates, shieldBypass: shieldBypass.filter(key => key !== id) });
}

export async function bypassShield(browser, id) {
  const { shieldEnabled = false } = await browser.storage.local.get('shieldEnabled');
  if (!shieldEnabled) return;
  const { shieldBypass = [] } = await browser.storage.session.get('shieldBypass');
  await browser.storage.session.set({ shieldBypass: [...new Set([...shieldBypass, id])] });
}

export async function configureShield(browser, enabled) {
  await browser.storage.local.set({ shieldEnabled: enabled });
  await browser.storage.session.set({ shieldCandidates: {}, shieldBypass: [] });
  return { enabled };
}
