import { closeDuplicates } from './duplicates.js';
import { bypassShield } from './shield.js';

function snapshot(tab, initial) {
  return { id: tab.id, url: tab.url, windowId: tab.windowId,
    index: initial?.windowId === tab.windowId ? initial.index : tab.index,
    pinned: Boolean(tab.pinned), incognito: Boolean(tab.incognito) };
}

export async function getUndoTabs(browser, openTabs) {
  const [{ lastCleanup = [], pendingCleanup = [] }, tabs] = await Promise.all([
    browser.storage.session.get(['lastCleanup', 'pendingCleanup']),
    openTabs ? Promise.resolve(openTabs) : browser.tabs.query({}),
  ]);
  const openIds = new Set(tabs.map(tab => tab.id));
  const interrupted = pendingCleanup.filter(tab => !openIds.has(tab.id));
  return (interrupted.length ? interrupted : lastCleanup).filter(tab => !openIds.has(tab.id));
}

export async function performCleanup(browser, selected) {
  const { smartMatching = false } = await browser.storage.local.get('smartMatching');
  const lastCleanup = await getUndoTabs(browser);
  const initial = new Map((await browser.tabs.query({})).map(tab => [tab.id, tab]));
  const closed = [];
  try {
    return await closeDuplicates(browser.tabs, selected, {
      smartMatching,
      async onBeforeClose(tab) {
        // A worker restart between removal and commit can still recover this tab.
        await browser.storage.session.set({ pendingCleanup: [...closed, snapshot(tab, initial.get(tab.id))] });
      },
      async onClosed(tab) {
        closed.push(snapshot(tab, initial.get(tab.id)));
        await browser.storage.session.set({ lastCleanup: closed, pendingCleanup: [] });
      },
    });
  } finally {
    // Failed or empty cleanups leave the previous Undo available.
    await browser.storage.session.set({ lastCleanup: closed.length ? closed : lastCleanup, pendingCleanup: [] });
  }
}

export async function undoCleanup(browser) {
  let pending = await getUndoTabs(browser);
  await browser.storage.session.set({ lastCleanup: pending, pendingCleanup: [] });
  const windows = new Map((await browser.windows.getAll({})).map(window => [window.id, window]));
  const result = { restored: 0, failed: 0 };
  const ordered = [...pending].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  for (const tab of ordered) {
    let restored;
    try {
      const target = windows.get(tab.restoredWindowId ?? tab.windowId);
      if (target && Boolean(target.incognito) === tab.incognito) {
        restored = await browser.tabs.create({ windowId: target.id, url: tab.url, index: tab.index, pinned: tab.pinned, active: false });
      } else {
        const created = await browser.windows.create({ url: tab.url, incognito: tab.incognito, focused: false });
        restored = created.tabs[0];
        windows.set(created.id, created);
        // Preserve the replacement-window mapping if a later restore needs retrying.
        for (const entry of pending) if (entry.windowId === tab.windowId) entry.restoredWindowId = created.id;
        if (tab.pinned) {
          try { await browser.tabs.update(restored.id, { pinned: true }); } catch { /* The URL was reopened; a concurrent close may prevent pinning. */ }
        }
      }
    } catch {
      result.failed++;
      continue;
    }
    if (restored) {
      await bypassShield(browser, restored.id);
      result.restored++;
      pending = pending.filter(entry => entry.id !== tab.id);
      await browser.storage.session.set({ lastCleanup: pending });
    }
  }
  await browser.storage.session.set({ lastCleanup: pending });
  return result;
}
