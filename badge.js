import { findDuplicateGroups } from './duplicates.js';

export async function refreshBadge(browser) {
  const [{ smartMatching = false }, tabs] = await Promise.all([
    browser.storage.local.get('smartMatching'), browser.tabs.query({}),
  ]);
  const count = findDuplicateGroups(tabs, { smartMatching }).reduce((sum, group) => sum + group.duplicates.length, 0);
  await browser.action.setBadgeBackgroundColor({ color: '#245e47' });
  await browser.action.setBadgeText({ text: count ? (count > 999 ? '999+' : String(count)) : '' });
  await browser.action.setTitle({ title: `Tab Tidy — ${count} duplicate tab${count === 1 ? '' : 's'} (${smartMatching ? 'tracking ignored' : 'exact URLs'})` });
}
