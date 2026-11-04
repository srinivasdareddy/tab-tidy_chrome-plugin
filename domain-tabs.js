function domain(tab) {
  if (tab.pinned || (tab.groupId !== undefined && tab.groupId !== -1) || tab.pendingUrl) return null;
  try {
    const url = new URL(tab.url);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname : null;
  } catch { return null; }
}

// Stable sibling ordering within each window. Protected tabs are boundaries:
// moving across one could split an existing group or disturb a pinned tab.
export async function arrangeDomains(browser, { windowId, automatic = false } = {}) {
  const result = { moved: 0, failed: 0 };
  if (automatic) {
    const { autoArrangeDomains = true } = await browser.storage.local.get('autoArrangeDomains');
    if (!autoArrangeDomains) return result;
  }
  const tabs = await browser.tabs.query(windowId === undefined ? {} : { windowId });
  const windows = new Map();
  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) windows.set(tab.windowId, []);
    windows.get(tab.windowId).push(tab);
  }
  for (const windowTabs of windows.values()) {
    windowTabs.sort((a, b) => a.index - b.index);
    for (let start = 0; start < windowTabs.length;) {
      if (!domain(windowTabs[start])) { start++; continue; }
      let end = start;
      const siblings = new Map();
      while (end < windowTabs.length && domain(windowTabs[end])) {
        const tab = windowTabs[end++];
        const key = domain(tab);
        if (!siblings.has(key)) siblings.set(key, []);
        siblings.get(key).push(tab);
      }
      const desired = [...siblings.values()].flat();
      const current = windowTabs.slice(start, end);
      const firstIndex = windowTabs[start].index;
      for (let i = 0; i < desired.length; i++) {
        const position = current.findIndex(tab => tab.id === desired[i].id);
        if (position === i) continue;
        try {
          const liveTabs = await browser.tabs.query({ windowId: desired[i].windowId });
          const byIndex = new Map(liveTabs.map(tab => [tab.index, tab]));
          if (current.some((tab, offset) => {
            const live = byIndex.get(firstIndex + offset);
            return live?.id !== tab.id || domain(live) !== domain(tab);
          })) {
            result.skipped = (result.skipped || 0) + 1;
            break;
          }
          await browser.tabs.move(desired[i].id, { index: firstIndex + i });
          current.splice(i, 0, current.splice(position, 1)[0]);
          result.moved++;
        } catch {
          result.failed++;
          break; // A drag, closed tab, or changed window makes this snapshot stale.
        }
      }
      start = end;
    }
  }
  return result;
}
