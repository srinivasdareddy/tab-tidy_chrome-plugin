import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateGroups, closeDuplicates } from '../duplicates.js';

const tab = (id, url, extra = {}) => ({ id, url, windowId: 1, index: id, pinned: false, active: false, incognito: false, ...extra });

test('finds extra copies across windows and preserves exact query strings and fragments', () => {
  const groups = findDuplicateGroups([
    tab(1, 'https://example.com/?q=a#one'),
    tab(2, 'https://example.com/?q=a#one', { windowId: 2 }),
    tab(3, 'https://example.com/?q=b#one'),
    tab(4, 'https://example.com/?q=a#two'),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keeper.id, 1);
  assert.deepEqual(groups[0].duplicates.map(t => t.id), [2]);
});

test('keeps a pinned copy first, otherwise an active copy, with a stable tie break', () => {
  const groups = findDuplicateGroups([
    tab(3, 'https://a.test', { active: true }),
    tab(2, 'https://a.test', { pinned: true }),
    tab(1, 'https://a.test'),
    tab(6, 'https://b.test'),
    tab(5, 'https://b.test', { active: true }),
  ]);
  assert.deepEqual(groups.map(g => g.keeper.id), [2, 5]);
  assert.deepEqual(groups[0].duplicates.map(t => t.id), [3, 1]);
});

test('ignores missing URLs, invalid IDs, and tabs in the middle of navigation', () => {
  const groups = findDuplicateGroups([
    tab(1, ''), tab(2, ''), tab(-1, 'https://a.test'),
    tab(3, 'https://a.test'),
    tab(4, 'https://a.test', { pendingUrl: 'https://b.test' }),
    tab(5, 'https://a.test'),
  ]);
  assert.deepEqual(groups[0].duplicates.map(t => t.id), [5]);
});

test('never combines regular and incognito tabs', () => {
  assert.equal(findDuplicateGroups([
    tab(1, 'https://a.test'), tab(2, 'https://a.test', { incognito: true }),
  ]).length, 0);
});

function browserTabs(initial, options = {}) {
  let tabs = structuredClone(initial);
  let queries = 0;
  return {
    async query(filter) {
      assert.deepEqual(filter, {});
      queries++;
      if (options.beforeQuery) tabs = options.beforeQuery(tabs, queries);
      return structuredClone(tabs);
    },
    async remove(id) {
      if (options.failId === id) throw new Error('Cannot close tab');
      tabs = tabs.filter(t => t.id !== id);
    },
    remaining: () => tabs.map(t => t.id),
  };
}

test('close all removes only selected extra copies and preserves unique tabs', async () => {
  const api = browserTabs([tab(1, 'https://a.test'), tab(2, 'https://a.test'), tab(3, 'https://a.test'), tab(4, 'https://b.test')]);
  const result = await closeDuplicates(api, [tab(2, 'https://a.test'), tab(3, 'https://a.test')]);
  assert.deepEqual(api.remaining(), [1, 4]);
  assert.deepEqual(result, { closed: 2, skipped: 0, failed: 0 });
});

test('single close only removes that copy', async () => {
  const api = browserTabs([tab(1, 'https://a.test'), tab(2, 'https://a.test'), tab(3, 'https://a.test')]);
  await closeDuplicates(api, [tab(3, 'https://a.test')]);
  assert.deepEqual(api.remaining(), [1, 2]);
});

test('rechecks each removal when the retained tab disappears during cleanup', async () => {
  const api = browserTabs([tab(1, 'https://a.test'), tab(2, 'https://a.test'), tab(3, 'https://a.test')], {
    beforeQuery: (tabs, n) => n === 2 ? tabs.filter(t => t.id !== 1) : tabs,
  });
  const result = await closeDuplicates(api, [tab(2, 'https://a.test'), tab(3, 'https://a.test')]);
  assert.deepEqual(api.remaining(), [3]);
  assert.deepEqual(result, { closed: 1, skipped: 1, failed: 0 });
});

test('skips tabs that navigated, vanished, or became the sole copy', async () => {
  const api = browserTabs([tab(1, 'https://a.test'), tab(2, 'https://b.test')]);
  const result = await closeDuplicates(api, [tab(2, 'https://a.test'), tab(3, 'https://a.test'), tab(1, 'https://a.test')]);
  assert.deepEqual(api.remaining(), [1, 2]);
  assert.deepEqual(result, { closed: 0, skipped: 3, failed: 0 });
});

test('reports failed closes and continues closing other duplicates', async () => {
  const api = browserTabs([tab(1, 'https://a.test'), tab(2, 'https://a.test'), tab(3, 'https://a.test')], { failId: 2 });
  const result = await closeDuplicates(api, [tab(2, 'https://a.test'), tab(3, 'https://a.test')]);
  assert.deepEqual(api.remaining(), [1, 2]);
  assert.deepEqual(result, { closed: 1, skipped: 0, failed: 1 });
});

test('smart matching ignores tracking tags only when enabled', () => {
  const tabs = [tab(1, 'https://a.test/page?q=cat#one'), tab(2, 'https://a.test/page?utm_source=news&q=cat&fbclid=123#one')];
  assert.equal(findDuplicateGroups(tabs).length, 0);
  const groups = findDuplicateGroups(tabs, { smartMatching: true });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].duplicates.map(t => t.id), [2]);
});

test('smart matching retains meaningful parameters, fragments, encoding, and parameter order', () => {
  const urls = ['https://a.test/?q=cat#one', 'https://a.test/?q=dog#one', 'https://a.test/?q=cat#two',
    'https://a.test/?q=cat&ref=home#one', 'https://a.test/?a=1&b=2', 'https://a.test/?b=2&a=1',
    'https://a.test/?q=a+b', 'https://a.test/?q=a%20b', 'https://a.test/?Q=cat#one'];
  assert.equal(findDuplicateGroups(urls.map((url, i) => tab(i, url)), { smartMatching: true }).length, 0);
});

test('smart matching handles all-tracking queries and encoded tracking names', () => {
  const groups = findDuplicateGroups([tab(1, 'https://a.test/page#x'),
    tab(2, 'https://a.test/page?%75tm_source=email&GCLID=123#x')], { smartMatching: true });
  assert.equal(groups.length, 1);
});

test('smart matching never alters non-web URLs or malformed query parameter names', () => {
  const urls = ['chrome://newtab/', 'chrome://newtab/?utm_source=a', 'https://a.test/?%zz=x', 'https://a.test/'];
  assert.equal(findDuplicateGroups(urls.map((url, i) => tab(i, url)), { smartMatching: true }).length, 0);
});

test('smart close revalidates using smart matches but does not close a navigated selection', async () => {
  const api = browserTabs([tab(1, 'https://a.test/'), tab(2, 'https://a.test/?utm_source=x'), tab(3, 'https://b.test/')]);
  const result = await closeDuplicates(api, [tab(2, 'https://a.test/?utm_source=x'), tab(3, 'https://a.test/?utm_source=y')], { smartMatching: true });
  assert.deepEqual(api.remaining(), [1, 3]);
  assert.deepEqual(result, { closed: 1, skipped: 1, failed: 0 });
});
