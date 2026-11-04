import { bypassShield } from './shield.js';

const webUrl = url => typeof url === 'string' && /^https?:\/\//i.test(url);

export function parkableTabs(tabs, hours = 0, now = Date.now()) {
  return tabs.filter(tab => Number.isInteger(tab.id) && tab.id >= 0 && webUrl(tab.url) && !tab.pendingUrl &&
    !tab.active && !tab.pinned && !tab.audible && (hours === 0 || (Number.isFinite(tab.lastAccessed) && now - tab.lastAccessed >= hours * 3600000)))
    .sort((a, b) => (a.lastAccessed ?? Infinity) - (b.lastAccessed ?? Infinity) || a.id - b.id);
}

export async function getParkedTabs(browser) {
  const [{ parkedTabs = [] }, { parkedPrivateTabs = [] }] = await Promise.all([
    browser.storage.local.get('parkedTabs'), browser.storage.session.get('parkedPrivateTabs'),
  ]);
  return [...(Array.isArray(parkedTabs) ? parkedTabs : []).map(entry => ({ ...entry, incognito: false })),
    ...(Array.isArray(parkedPrivateTabs) ? parkedPrivateTabs : []).map(entry => ({ ...entry, incognito: true }))]
    .filter(entry => typeof entry.id === 'string' && webUrl(entry.url))
    .sort((a, b) => b.parkedAt - a.parkedAt);
}

function storageFor(browser, incognito) {
  return incognito ? { area: browser.storage.session, key: 'parkedPrivateTabs' } : { area: browser.storage.local, key: 'parkedTabs' };
}

export async function parkTabs(browser, selected, hours = 0) {
  const result = { parked: 0, skipped: 0, failed: 0 };
  for (const candidate of selected) {
    const current = (await browser.tabs.query({})).find(tab => tab.id === candidate.id);
    if (!current || current.url !== candidate.url || Boolean(current.incognito) !== Boolean(candidate.incognito) || !parkableTabs([current], hours).length) {
      result.skipped++;
      continue;
    }
    const { area, key } = storageFor(browser, current.incognito);
    const stored = await area.get(key);
    const entries = Array.isArray(stored[key]) ? stored[key] : [];
    const existing = entries.find(entry => entry.url === current.url);
    const entry = existing || { id: crypto.randomUUID(), title: current.title || current.url, url: current.url,
      parkedAt: Date.now(), windowId: current.windowId, index: current.index };
    // Persist first. Storage failure must never cost the user an open tab.
    if (!existing) await area.set({ [key]: [...entries, entry] });
    try {
      // The save may take time; revalidate activity, audio, and navigation once more.
      const fresh = (await browser.tabs.query({})).find(tab => tab.id === current.id);
      if (!fresh || fresh.url !== current.url || !parkableTabs([fresh], hours).length) {
        if (!existing) await area.set({ [key]: entries });
        result.skipped++;
        continue;
      }
      await browser.tabs.remove(current.id);
      result.parked++;
    } catch {
      if (!existing) await area.set({ [key]: entries });
      result.failed++;
    }
  }
  return result;
}

export async function deleteParked(browser, id) {
  const entry = (await getParkedTabs(browser)).find(entry => entry.id === id);
  if (!entry) return { deleted: 0 };
  const { area, key } = storageFor(browser, entry.incognito);
  const stored = await area.get(key);
  await area.set({ [key]: stored[key].filter(item => item.id !== id) });
  return { deleted: 1 };
}

export async function reopenParked(browser, id) {
  const entry = (await getParkedTabs(browser)).find(entry => entry.id === id);
  if (!entry) return { reopened: 0 };
  const existing = (await browser.tabs.query({})).find(tab => tab.url === entry.url && !tab.pendingUrl && Boolean(tab.incognito) === entry.incognito);
  if (existing) {
    await browser.tabs.update(existing.id, { active: true });
    await browser.windows.update(existing.windowId, { focused: true });
  } else {
    const windows = await browser.windows.getAll({});
    const target = windows.find(window => window.id === entry.windowId && Boolean(window.incognito) === entry.incognito) || windows.find(window => Boolean(window.incognito) === entry.incognito);
    if (target) {
      const created = await browser.tabs.create({ windowId: target.id, url: entry.url, active: true });
      await bypassShield(browser, created.id);
      await browser.windows.update(target.id, { focused: true });
    } else {
      const created = await browser.windows.create({ url: entry.url, incognito: entry.incognito, focused: true });
      await bypassShield(browser, created.tabs[0].id);
    }
  }
  await deleteParked(browser, id);
  return { reopened: 1 };
}
