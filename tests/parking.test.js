import test from 'node:test';
import assert from 'node:assert/strict';
import { parkableTabs, getParkedTabs, parkTabs, reopenParked, deleteParked } from '../parking.js';
import { fakeBrowser, tab } from './helpers/browser.js';

test('bulk parking respects age and excludes active, pinned, audible and navigating tabs', () => {
  const now = Date.now();
  const tabs = [tab(1, 'https://a.test/'), tab(2, 'https://b.test/', { active: true }), tab(3, 'https://c.test/', { pinned: true }),
    tab(4, 'https://d.test/', { audible: true }), tab(5, 'https://e.test/', { pendingUrl: 'https://other.test/' }),
    tab(6, 'https://f.test/', { lastAccessed: now }), tab(7, 'chrome://settings/'), tab(8, 'https://g.test/', { lastAccessed: undefined })];
  assert.deepEqual(parkableTabs(tabs, 24, now).map(t => t.id), [1]);
  assert.deepEqual(parkableTabs(tabs, 0, now).map(t => t.id), [1, 6, 8]);
});

test('parking saves title and exact URL before closing the tab', async () => {
  const original = tab(2, 'https://a.test/?utm_source=x#one', { title: 'Read this later' });
  const browser = fakeBrowser([tab(1, 'https://unique.test/', { active: true }), original]);
  const remove = browser.tabs.remove;
  browser.tabs.remove = async id => {
    assert.equal(browser.local.parkedTabs[0].url, original.url);
    await remove(id);
  };
  assert.equal((await parkTabs(browser, [original])).parked, 1);
  assert.deepEqual(browser.list().map(t => t.id), [1]);
  const saved = await getParkedTabs(browser);
  assert.equal(saved[0].title, 'Read this later');
  assert.equal(saved[0].url, original.url);
});

test('parking revalidates tabs and skips tabs that became active or navigated', async () => {
  const original = [tab(1, 'https://a.test/'), tab(2, 'https://b.test/')];
  const browser = fakeBrowser(original);
  browser.change(1, { active: true });
  browser.change(2, { url: 'https://different.test/' });
  assert.equal((await parkTabs(browser, original)).skipped, 2);
  assert.equal((await getParkedTabs(browser)).length, 0);
});

test('bulk parking rechecks the two-day cutoff after saving the backup', async () => {
  const original = tab(1, 'https://a.test/', { lastAccessed: Date.now() - 72 * 3600000 });
  const browser = fakeBrowser([original]);
  const query = browser.tabs.query;
  let count = 0;
  browser.tabs.query = async () => {
    if (++count === 2) browser.change(1, { lastAccessed: Date.now() });
    return query();
  };
  assert.equal((await parkTabs(browser, [original], 48)).skipped, 1);
  assert.equal(browser.list().length, 1);
});

test('a failed save leaves the tab open, and a failed close removes only its new backup', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  browser.storage.local.set = async () => { throw new Error('Storage full'); };
  await assert.rejects(() => parkTabs(browser, browser.list()));
  assert.equal(browser.list().length, 1);
  const other = fakeBrowser([tab(1, 'https://a.test/')]);
  other.failRemove = 1;
  assert.equal((await parkTabs(other, other.list())).failed, 1);
  assert.equal((await getParkedTabs(other)).length, 0);
});

test('parking identical URLs creates one shelf entry', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://a.test/')]);
  assert.equal((await parkTabs(browser, browser.list())).parked, 2);
  assert.equal((await getParkedTabs(browser)).length, 1);
});

test('reopen removes saved entry only after successfully reopening its original URL', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/')]);
  await parkTabs(browser, browser.list());
  const [saved] = await getParkedTabs(browser);
  browser.failCreate = true;
  await assert.rejects(() => reopenParked(browser, saved.id));
  assert.equal((await getParkedTabs(browser)).length, 1);
  browser.failCreate = false;
  assert.equal((await reopenParked(browser, saved.id)).reopened, 1);
  assert.equal(browser.list()[0].url, 'https://a.test/');
  assert.equal((await getParkedTabs(browser)).length, 0);
});

test('reopening an already-open URL focuses it instead of adding another copy', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://a.test/', { active: true })]);
  await parkTabs(browser, [browser.list()[0]]);
  const [saved] = await getParkedTabs(browser);
  await reopenParked(browser, saved.id);
  assert.deepEqual(browser.list().map(t => t.id), [2]);
  assert.equal((await getParkedTabs(browser)).length, 0);
});

test('private parked tabs are saved in session memory only and reopen privately', async () => {
  const browser = fakeBrowser([tab(1, 'https://private.test/', { incognito: true })]);
  await parkTabs(browser, browser.list());
  assert.equal((browser.local.parkedTabs || []).length, 0);
  assert.equal(browser.session.parkedPrivateTabs.length, 1);
  const [saved] = await getParkedTabs(browser);
  await reopenParked(browser, saved.id);
  assert.equal(browser.list()[0].incognito, true);
});

test('delete removes only the selected saved link and never closes open tabs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/')]);
  await parkTabs(browser, browser.list());
  const [saved] = await getParkedTabs(browser);
  await deleteParked(browser, saved.id);
  assert.equal((await getParkedTabs(browser)).length, 1);
  assert.equal(browser.list().length, 0);
});
