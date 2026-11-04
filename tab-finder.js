export function finderDomain(tab) {
  try {
    const url = new URL(tab.pendingUrl || tab.url);
    if (['chrome:', 'about:', 'edge:'].includes(url.protocol)) return 'Browser pages';
    if (url.protocol === 'file:') return 'Local files';
    return url.hostname || 'Other tabs';
  } catch { return 'Other tabs'; }
}

export function groupFinderTabs(tabs, ownOrigin = '') {
  const groups = new Map();
  const ordered = [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  for (const tab of ordered) {
    const url = tab.pendingUrl || tab.url || '';
    if (ownOrigin && url.startsWith(ownOrigin)) continue;
    const domain = finderDomain(tab);
    if (!groups.has(domain)) groups.set(domain, { domain, tabs: [] });
    groups.get(domain).tabs.push({ ...tab, url, title: tab.title?.trim() || url || 'Untitled tab' });
  }
  return [...groups.values()].sort((a, b) => b.tabs.length - a.tabs.length || a.domain.localeCompare(b.domain));
}

export function filterFinderTabs(groups, domain = null, query = '') {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return groups.filter(group => domain === null || group.domain === domain).flatMap(group => group.tabs)
    .filter(tab => terms.every(term => `${tab.title} ${tab.url}`.toLowerCase().includes(term)));
}

export async function activateFinderTab(browser, tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Invalid tab selection.');
  // The update result has the latest window if a tab moved since it was listed.
  const tab = await browser.tabs.update(tabId, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
  return { focused: 1 };
}
