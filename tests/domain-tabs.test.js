import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeDomains } from '../domain-tabs.js';
import { fakeBrowser, tab } from './helpers/browser.js';

const ids = browser => browser.list().sort((a, b) => a.windowId - b.windowId || a.index - b.index).map(t => t.id);

test('domain siblings stay in first-seen order, preserving order within each domain', async () => {
  const browser = fakeBrowser([
    tab(1, 'https://a.test/one', { active: true }), tab(2, 'https://b.test/one'),
    tab(3, 'http://a.test/two'), tab(4, 'https://c.test/'), tab(5, 'https://b.test/two'),
  ]);
  assert.deepEqual(await arrangeDomains(browser), { moved: 2, failed: 0 });
  assert.deepEqual(ids(browser), [1, 3, 2, 5, 4]);
  assert.equal(browser.list().find(t => t.active).id, 1);
  assert.deepEqual(await arrangeDomains(browser), { moved: 0, failed: 0 });
});

test('automatic arrangement defaults on, respects off, and manual arrangement still works', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/1'), tab(2, 'https://b.test/'), tab(3, 'https://a.test/2')]);
  await arrangeDomains(browser, { automatic: true });
  assert.deepEqual(ids(browser), [1, 3, 2]);
  await browser.tabs.move(3, { index: 2 });
  browser.local.autoArrangeDomains = false;
  await arrangeDomains(browser, { automatic: true });
  assert.deepEqual(ids(browser), [1, 2, 3]);
  await arrangeDomains(browser);
  assert.deepEqual(ids(browser), [1, 3, 2]);
});

test('arranges each window separately and can target only one window', async () => {
  const browser = fakeBrowser([
    tab(1, 'https://a.test/1'), tab(2, 'https://b.test/'), tab(3, 'https://a.test/2'),
    tab(4, 'https://a.test/3', { windowId: 2, index: 0, incognito: true }),
    tab(5, 'https://b.test/', { windowId: 2, index: 1, incognito: true }),
    tab(6, 'https://a.test/4', { windowId: 2, index: 2, incognito: true }),
  ]);
  await arrangeDomains(browser, { windowId: 2 });
  assert.deepEqual(ids(browser), [1, 2, 3, 4, 6, 5]);
  await arrangeDomains(browser);
  assert.deepEqual(ids(browser), [1, 3, 2, 4, 6, 5]);
  assert.equal(browser.list().find(t => t.id === 6).incognito, true);
});

test('pinned, grouped, internal and navigating tabs form boundaries that stay in place', async () => {
  const browser = fakeBrowser([
    tab(1, 'https://a.test/', { pinned: true }),
    tab(2, 'https://a.test/1'), tab(3, 'https://b.test/'), tab(4, 'https://a.test/2'),
    tab(5, 'https://a.test/grouped', { groupId: 7 }),
    tab(6, 'https://b.test/1'), tab(7, 'https://a.test/3'), tab(8, 'https://b.test/2'),
    tab(9, 'chrome://newtab/'),
    tab(10, 'https://a.test/4'), tab(11, 'https://b.test/3', { pendingUrl: 'https://a.test/new' }),
    tab(12, 'https://a.test/5'),
  ]);
  await arrangeDomains(browser);
  assert.deepEqual(ids(browser), [1, 2, 4, 3, 5, 6, 8, 7, 9, 10, 11, 12]);
  assert.equal(browser.list().find(t => t.id === 5).groupId, 7);
});

test('subdomains stay separate and failed moves leave every tab open', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://sub.a.test/'), tab(3, 'https://a.test/2')]);
  browser.tabs.move = async () => { throw new Error('User dragging a tab'); };
  assert.deepEqual(await arrangeDomains(browser), { moved: 0, failed: 1 });
  assert.deepEqual(ids(browser), [1, 2, 3]);
});

test('a newly protected intervening tab invalidates the arrangement snapshot', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/'), tab(3, 'https://a.test/2')]);
  const query = browser.tabs.query;
  browser.tabs.query = async options => {
    const snapshot = await query(options);
    browser.change(2, { groupId: 7 });
    return snapshot;
  };
  const result = await arrangeDomains(browser);
  assert.deepEqual(ids(browser), [1, 2, 3]);
  assert.equal(result.skipped, 1);
});
