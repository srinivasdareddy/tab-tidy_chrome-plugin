import test from 'node:test';
import assert from 'node:assert/strict';
import { shieldCreated, shieldUpdated, bypassShield, configureShield } from '../shield.js';
import { fakeBrowser, tab } from './helpers/browser.js';

test('shield is off by default and leaves existing duplicates alone', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://a.test/')]);
  await shieldCreated(browser, browser.list()[1]);
  assert.deepEqual(browser.list().map(t => t.id), [1, 2]);
});

test('shield removes a newly opened duplicate and focuses its existing copy', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/', { windowId: 2 }), tab(2, 'https://a.test/', { active: true })]);
  browser.local.shieldEnabled = true;
  assert.equal((await shieldCreated(browser, browser.list()[1])).blocked, true);
  assert.deepEqual(browser.list().map(t => t.id), [1]);
  assert.equal(browser.list()[0].active, true);
});

test('shield handles a new blank tab gaining a URL but ignores later navigation of an accepted tab', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'chrome://newtab/')]);
  browser.local.shieldEnabled = true;
  await shieldCreated(browser, browser.list()[1]);
  browser.change(2, { pendingUrl: 'https://a.test/', status: 'loading' });
  assert.equal((await shieldUpdated(browser, 2)).blocked, true);
  browser.add(tab(3, 'https://unique.test/'));
  await shieldCreated(browser, browser.list().find(t => t.id === 3));
  browser.change(3, { url: 'https://a.test/' });
  await shieldUpdated(browser, 3);
  assert.deepEqual(browser.list().map(t => t.id), [1, 3]);
});

test('shield honors smart matching while preserving meaningful parameters', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/?q=cat'), tab(2, 'https://a.test/?q=cat&utm_source=x'), tab(3, 'https://a.test/?q=dog')]);
  Object.assign(browser.local, { shieldEnabled: true, smartMatching: true });
  await shieldCreated(browser, browser.list()[1]);
  await shieldCreated(browser, browser.list().find(t => t.id === 3));
  assert.deepEqual(browser.list().map(t => t.id), [1, 3]);
});

test('shield protects pinned and audible tabs and never combines privacy contexts', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://a.test/', { pinned: true }), tab(3, 'https://a.test/', { audible: true }), tab(4, 'https://a.test/', { incognito: true, windowId: 2 })]);
  browser.local.shieldEnabled = true;
  for (const candidate of browser.list().slice(1)) await shieldCreated(browser, candidate);
  assert.equal(browser.list().length, 4);
});

test('intentional restores bypass shield through their initial navigation', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, '', { pendingUrl: 'https://a.test/', status: 'loading' })]);
  browser.local.shieldEnabled = true;
  await bypassShield(browser, 2);
  await shieldCreated(browser, browser.list()[1]);
  browser.change(2, { url: 'https://a.test/', pendingUrl: undefined, status: 'complete' });
  await shieldUpdated(browser, 2);
  assert.equal(browser.list().length, 2);
});

test('turning shield on does not arm already-open tabs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/')]);
  await configureShield(browser, true);
  browser.change(2, { url: 'https://a.test/' });
  await shieldUpdated(browser, 2);
  assert.equal(browser.list().length, 2);
  assert.equal(browser.local.shieldEnabled, true);
});

test('shield keeps the new tab when an existing copy cannot be activated', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://a.test/')]);
  browser.local.shieldEnabled = true;
  browser.tabs.update = async () => { throw new Error('Tab disappeared'); };
  await shieldCreated(browser, browser.list()[1]);
  assert.equal(browser.list().length, 2);
});
