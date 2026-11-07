export async function handleCommand(command, tab) {
  if (command !== 'open-tab-finder') return;
  await navigator.locks.request('tab-tidy-finder-shortcut', async () => {
    const activeTab = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!activeTab) return;
    const tabId = activeTab.id;
    const popup = await chrome.action.getPopup({ tabId });
    try {
      // Scope the launch URL to this tab, then restore normal toolbar behavior.
      await chrome.action.setPopup({ tabId, popup: 'popup.html?view=finder' });
      await chrome.action.openPopup({ windowId: activeTab.windowId });
    } finally {
      await chrome.action.setPopup({ tabId, popup });
    }
  });
}
