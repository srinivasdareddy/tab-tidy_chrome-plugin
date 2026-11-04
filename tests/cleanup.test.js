import test from 'node:test';
import assert from 'node:assert/strict';
import { performCleanup, undoCleanup } from '../cleanup.js';

const tab = (id, url, extra = {}) => ({ id, url, windowId: 1, index: id - 1, pinned: false, active: false, incognito: false, ...extra });
function fakeBrowser(initial, { failClose, failRestore } = {}) {
  let tabs = structuredClone(initial);
  let nextId = 100;
  let nextWindow = 10;
  const windows = new Map([...new Set(tabs.map(t => t.windowId))].map(id => [id, { id, incognito: Boolean(tabs.find(t => t.windowId === id).incognito) }]));
  const session = {};
  const local = {};
  const area = values => ({
    async get() { return structuredClone(values); },
    async set(update) { Object.assign(values, structuredClone(update)); },
  });
  const browser = {
    storage: { session: area(session), local: area(local) },
    tabs: {
      async query() { return structuredClone(tabs); },
      async remove(id) {
        if (id === failClose) throw new Error('Close refused');
        tabs = tabs.filter(t => t.id !== id);
        for (const [id] of windows) if (!tabs.some(t => t.windowId === id)) windows.delete(id);
      },
      async create(properties) {
        if (properties.url === browser.failRestore) throw new Error('Restore refused');
        if (!windows.has(properties.windowId)) throw new Error('Window missing');
        const created = tab(nextId++, properties.url, { ...properties, incognito: windows.get(properties.windowId).incognito });
        tabs.push(created);
        return structuredClone(created);
      },
      async update(id, update) { Object.assign(tabs.find(t => t.id === id), update); },
    },
    windows: {
      async getAll() { return [...windows.values()]; },
      async create(properties) {
        if (properties.url === browser.failRestore) throw new Error('Restore refused');
        const window = { id: nextWindow++, incognito: Boolean(properties.incognito) };
        windows.set(window.id, window);
        const created = tab(nextId++, properties.url, { windowId: window.id, index: 0, incognito: window.incognito });
        tabs.push(created);
        return { ...window, tabs: [created] };
      },
    },
    failRestore,
    list: () => structuredClone(tabs),
    session,
    local,
  };
  return browser;
}

test('undo restores only the last cleanup with original URL, window, position and pin', async () => {
  const original = tab(2, 'https://a.test/', { pinned: true });
  const browser = fakeBrowser([tab(1, 'https://a.test/', { pinned: true }), original, tab(3, 'https://unique.test/')]);
  const result = await performCleanup(browser, [original]);
  assert.equal(result.closed, 1);
  assert.deepEqual(browser.list().map(t => t.id), [1, 3]);
  const undone = await undoCleanup(browser);
  assert.equal(undone.restored, 1);
  const restored = browser.list().find(t => t.id >= 100);
  assert.deepEqual({ url: restored.url, windowId: restored.windowId, index: restored.index, pinned: restored.pinned },
    { url: 'https://a.test/', windowId: 1, index: 1, pinned: true });
  assert.equal((await undoCleanup(browser)).restored, 0);
});

test('a new cleanup replaces undo, but a no-op or failed cleanup preserves it', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://a.test/'), tab(3, 'https://b.test/'), tab(4, 'https://b.test/')], { failClose: 3 });
  await performCleanup(browser, [tab(2, 'https://a.test/')]);
  await performCleanup(browser, [tab(3, 'https://b.test/')]);
  await performCleanup(browser, [tab(99, 'https://none.test/')]);
  await undoCleanup(browser);
  assert.equal(browser.list().filter(t => t.url === 'https://a.test/').length, 2);
  await performCleanup(browser, [browser.list().find(t => t.id >= 100)]);
  await performCleanup(browser, [tab(4, 'https://b.test/')]);
  await undoCleanup(browser);
  assert.equal(browser.list().filter(t => t.url === 'https://a.test/').length, 1);
  assert.equal(browser.list().filter(t => t.url === 'https://b.test/').length, 2);
});

test('undo recreates a closed window once for its restored tabs', async () => {
  const removed = [tab(2, 'https://a.test/', { windowId: 2, index: 0 }), tab(3, 'https://a.test/', { windowId: 2, index: 1 })];
  const browser = fakeBrowser([tab(1, 'https://a.test/'), ...removed]);
  await performCleanup(browser, removed);
  assert.equal((await undoCleanup(browser)).restored, 2);
  const restored = browser.list().filter(t => t.id >= 100);
  assert.equal(restored[0].windowId, restored[1].windowId);
  assert.equal(restored[0].windowId, 10);
});

test('partial undo retains only failed restores and retries without duplicating restored tabs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://a.test/'), tab(3, 'https://b.test/'), tab(4, 'https://b.test/')], { failRestore: 'https://b.test/' });
  await performCleanup(browser, [tab(2, 'https://a.test/'), tab(4, 'https://b.test/')]);
  const first = await undoCleanup(browser);
  assert.equal(first.restored, 1);
  assert.equal(first.failed, 1);
  browser.failRestore = undefined;
  assert.equal((await undoCleanup(browser)).restored, 1);
  assert.equal(browser.list().filter(t => t.url === 'https://a.test/').length, 2);
  assert.equal(browser.list().filter(t => t.url === 'https://b.test/').length, 2);
});

test('smart cleanup retains the original tracked URL for undo', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/?q=1'), tab(2, 'https://a.test/?q=1&utm_source=email')]);
  browser.local.smartMatching = true;
  assert.equal((await performCleanup(browser, [tab(2, 'https://a.test/?q=1&utm_source=email')])).closed, 1);
  await undoCleanup(browser);
  assert.equal(browser.list().filter(t => t.url === 'https://a.test/?q=1&utm_source=email').length, 1);
});

test('undo keeps incognito tabs in incognito windows', async () => {
  const removed = tab(2, 'https://a.test/', { windowId: 2, incognito: true });
  const browser = fakeBrowser([tab(1, 'https://a.test/', { incognito: true }), removed]);
  await performCleanup(browser, [removed]);
  assert.equal((await undoCleanup(browser)).restored, 1);
  assert.equal(browser.list().find(t => t.id >= 100).incognito, true);
});

test('undo never reopens an original tab that is still present in recovery data', async () => {
  const original = tab(1, 'https://a.test/');
  const browser = fakeBrowser([original]);
  browser.session.lastCleanup = [original];
  assert.equal((await undoCleanup(browser)).restored, 0);
  assert.equal(browser.list().length, 1);
});

test('worker restart before removal preserves the previous cleanup Undo', async () => {
  const original = [tab(1, 'https://a.test/'), tab(2, 'https://a.test/')];
  const browser = fakeBrowser(original);
  browser.session.lastCleanup = [tab(9, 'https://previous.test/')];
  let reachedRemoval;
  const paused = new Promise(resolve => { reachedRemoval = resolve; });
  browser.tabs.remove = async () => { reachedRemoval(); await new Promise(() => {}); };
  void performCleanup(browser, [original[1]]);
  await paused;
  const restarted = fakeBrowser(browser.list());
  Object.assign(restarted.session, structuredClone(browser.session));
  assert.equal((await undoCleanup(restarted)).restored, 1);
  assert.equal(restarted.list().some(t => t.url === 'https://previous.test/'), true);
});

test('worker restart after removal recovers the new cleanup instead of the previous one', async () => {
  const original = [tab(1, 'https://a.test/'), tab(2, 'https://a.test/')];
  const browser = fakeBrowser(original);
  browser.session.lastCleanup = [tab(9, 'https://previous.test/')];
  let reachedRemoval;
  const paused = new Promise(resolve => { reachedRemoval = resolve; });
  const remove = browser.tabs.remove;
  browser.tabs.remove = async id => { await remove(id); reachedRemoval(); await new Promise(() => {}); };
  void performCleanup(browser, [original[1]]);
  await paused;
  const restarted = fakeBrowser(browser.list());
  Object.assign(restarted.session, structuredClone(browser.session));
  assert.equal((await undoCleanup(restarted)).restored, 1);
  assert.equal(restarted.list().filter(t => t.url === 'https://a.test/').length, 2);
  assert.equal(restarted.list().some(t => t.url === 'https://previous.test/'), false);
});
