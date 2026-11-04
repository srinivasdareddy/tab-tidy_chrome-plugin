import { performCleanup, undoCleanup } from './cleanup.js';
import { refreshBadge } from './badge.js';
import { shieldCreated, shieldUpdated, forgetShieldTab, configureShield } from './shield.js';
import { parkableTabs, parkTabs, reopenParked, deleteParked } from './parking.js';
import { arrangeDomains } from './domain-tabs.js';
import { activateFinderTab } from './tab-finder.js';

async function autoArrange(windowId) {
  try {
    await navigator.locks.request('tab-tidy-cleanup', async () => arrangeDomains(chrome, { windowId, automatic: true }));
  } catch { /* A failed automatic arrangement leaves tabs open. */ }
}

async function runShield(operation, value) {
  try {
    await navigator.locks.request('tab-tidy-cleanup', async () => operation(chrome, value));
  } catch { /* A failed automatic check leaves the user's tabs alone. */ }
}

async function performAction(request) {
  switch (request.type) {
    case 'focus-tab': return activateFinderTab(chrome, request.tabId);
    case 'close-duplicates': return performCleanup(chrome, request.tabs);
    case 'undo-cleanup': return undoCleanup(chrome);
    case 'set-shield': return configureShield(chrome, request.enabled);
    case 'park-tabs': return parkTabs(chrome, request.tabs);
    case 'reopen-parked': return reopenParked(chrome, request.id);
    case 'delete-parked': return deleteParked(chrome, request.id);
    case 'arrange-domains': return arrangeDomains(chrome);
    case 'park-inactive': {
      const { parkInactiveHours = 48 } = await chrome.storage.local.get('parkInactiveHours');
      const hours = [0, 24, 48].includes(parkInactiveHours) ? parkInactiveHours : 48;
      return parkTabs(chrome, parkableTabs(await chrome.tabs.query({}), hours), hours);
    }
  }
}

async function updateBadge() {
  try {
    // Serialize scans so older results cannot overwrite newer counts.
    await navigator.locks.request('tab-tidy-badge', async () => refreshBadge(chrome));
  } catch {
    try {
      await chrome.action.setBadgeText({ text: '?' });
      await chrome.action.setTitle({ title: 'Tab Tidy — Could not scan tabs. Open the popup to retry.' });
    } catch { /* Chrome may be shutting down. */ }
  }
}

// The worker owns cleanup so it continues if the popup or its active tab closes.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !['focus-tab', 'close-duplicates', 'undo-cleanup', 'set-shield', 'park-tabs', 'park-inactive', 'reopen-parked', 'delete-parked', 'arrange-domains'].includes(request?.type)) return;
  if (request.type === 'focus-tab' && (!Number.isInteger(request.tabId) || request.tabId < 0)) {
    sendResponse({ error: 'Invalid tab selection.' });
    return;
  }
  if (['close-duplicates', 'park-tabs'].includes(request.type) && (!Array.isArray(request.tabs) || request.tabs.some(tab => !Number.isInteger(tab?.id) || typeof tab.url !== 'string'))) {
    sendResponse({ error: 'Invalid tab selection.' });
    return;
  }
  if ((request.type === 'set-shield' && typeof request.enabled !== 'boolean') ||
      (['reopen-parked', 'delete-parked'].includes(request.type) && typeof request.id !== 'string')) {
    sendResponse({ error: 'Invalid action.' });
    return;
  }
  async function respond() {
    try {
      // Two popups must not close different retained copies at the same time.
      const result = await navigator.locks.request('tab-tidy-cleanup', async () => performAction(request));
      sendResponse({ result });
    } catch {
      sendResponse({ error: 'Action interrupted. Refresh to check tabs, parking lot, and available Undo.' });
    } finally {
      await updateBadge();
    }
  }
  void respond();
  return true;
});

chrome.tabs.onCreated.addListener(tab => { void runShield(shieldCreated, tab); void autoArrange(tab.windowId); void updateBadge(); });
chrome.tabs.onRemoved.addListener((id, info) => { void runShield(forgetShieldTab, id); if (!info.isWindowClosing) void autoArrange(info.windowId); void updateBadge(); });
chrome.tabs.onUpdated.addListener((id, changes, tab) => {
  if ('url' in changes || 'status' in changes) { void runShield(shieldUpdated, id); void updateBadge(); }
  if ('url' in changes || changes.status === 'complete' || 'pinned' in changes || 'groupId' in changes) void autoArrange(tab.windowId);
});
chrome.tabs.onAttached.addListener((_id, info) => { void autoArrange(info.newWindowId); void updateBadge(); });
chrome.tabs.onDetached.addListener((_id, info) => { void autoArrange(info.oldWindowId); void updateBadge(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'smartMatching' in changes) void updateBadge();
  if (area === 'local' && 'autoArrangeDomains' in changes && changes.autoArrangeDomains.newValue !== false) void autoArrange();
});
chrome.runtime.onInstalled.addListener(() => { void autoArrange(); void updateBadge(); });
chrome.runtime.onStartup.addListener(() => { void autoArrange(); void updateBadge(); });
void updateBadge();
