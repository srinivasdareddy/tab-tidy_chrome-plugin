import test from 'node:test';
import assert from 'node:assert/strict';
import { finderDomain, groupFinderTabs, filterFinderTabs, activateFinderTab } from '../tab-finder.js';
import { fakeBrowser, tab } from './helpers/browser.js';

test('finder groups every same-host URL without merging subdomains or duplicate copies', () => {
  const groups = groupFinderTabs([
    tab(1, 'https://acme.atlassian.net/browse/ENG-1'),
    tab(2, 'https://github.com/acme/web'),
    tab(3, 'http://acme.atlassian.net/browse/ENG-2'),
    tab(4, 'https://acme.atlassian.net/browse/ENG-2'),
    tab(5, 'https://other.atlassian.net/browse/ENG-1'),
  ]);
  assert.deepEqual(groups.map(g => [g.domain, g.tabs.map(t => t.id)]), [
    ['acme.atlassian.net', [1, 3, 4]], ['github.com', [2]], ['other.atlassian.net', [5]],
  ]);
});

test('finder uses pending destinations, includes browser/local pages, and skips its own pages', () => {
  const groups = groupFinderTabs([
    tab(1, 'https://old.test/', { pendingUrl: 'https://new.test/ticket', title: '' }),
    tab(2, 'chrome://settings/'), tab(3, 'about:blank'), tab(4, 'file:///tmp/notes.txt'),
    tab(5, undefined, { title: '' }), tab(6, 'chrome-extension://self/popup.html'),
  ], 'chrome-extension://self/');
  assert.equal(groups.flatMap(g => g.tabs).length, 5);
  assert.equal(finderDomain(tab(2, 'chrome://settings/')), 'Browser pages');
  assert.equal(finderDomain(tab(3, 'file:///tmp/notes.txt')), 'Local files');
  assert.equal(finderDomain(tab(4, 'not-a-url')), 'Other tabs');
  assert.equal(groups.find(g => g.domain === 'Browser pages').tabs.length, 2);
  assert.equal(groups.find(g => g.domain === 'new.test').tabs[0].title, 'https://new.test/ticket');
  assert.equal(groups.find(g => g.domain === 'Other tabs').tabs[0].title, 'Untitled tab');
});

test('finder keeps browser order within domains and preserves private and protected tabs', () => {
  const groups = groupFinderTabs([
    tab(3, 'https://a.test/3', { windowId: 2, index: 0, incognito: true }),
    tab(2, 'https://a.test/2', { index: 1, pinned: true, audible: true }),
    tab(1, 'https://a.test/1', { index: 0 }),
  ]);
  assert.deepEqual(groups[0].tabs.map(t => t.id), [1, 2, 3]);
  assert.equal(groups[0].tabs[1].pinned, true);
  assert.equal(groups[0].tabs[1].audible, true);
  assert.equal(groups[0].tabs[2].incognito, true);
});

test('finder shows all titles without typing and optionally matches title or URL within a domain', () => {
  const groups = groupFinderTabs([
    tab(1, 'https://jira.test/browse/ENG-2485', { title: 'Dashboard loading performance' }),
    tab(2, 'https://jira.test/browse/ENG-2', { title: 'Billing settings' }),
    tab(3, 'https://github.com/acme/performance', { title: 'Performance review' }),
  ]);
  assert.equal(filterFinderTabs(groups, null).length, 3);
  assert.deepEqual(filterFinderTabs(groups, 'jira.test').map(t => t.id), [1, 2]);
  assert.deepEqual(filterFinderTabs(groups, 'jira.test', '  DASHBOARD 2485 ').map(t => t.id), [1]);
  assert.deepEqual(filterFinderTabs(groups, null, 'performance').map(t => t.id), [1, 3]);
  assert.deepEqual(filterFinderTabs(groups, 'jira.test', 'missing'), []);
});

test('finder activates an existing tab and focuses its window without navigating or closing anything', async () => {
  const browser = fakeBrowser([tab(1, 'https://jira.test/one', { active: true }), tab(2, 'https://jira.test/two', { windowId: 2 })]);
  assert.deepEqual(await activateFinderTab(browser, 2), { focused: 1 });
  assert.deepEqual(browser.list().map(t => [t.id, t.url]), [[1, 'https://jira.test/one'], [2, 'https://jira.test/two']]);
  assert.equal(browser.list().find(t => t.id === 2).active, true);
  assert.equal((await browser.windows.getAll()).find(w => w.id === 2).focused, true);
});

test('finder uses the activation result window when a tab moves and rejects vanished or invalid IDs', async () => {
  const browser = fakeBrowser([tab(1, 'https://a.test/'), tab(2, 'https://b.test/', { windowId: 2 })]);
  const update = browser.tabs.update;
  browser.tabs.update = async (id, properties) => { browser.change(id, { windowId: 2 }); return update(id, properties); };
  await activateFinderTab(browser, 1);
  assert.equal((await browser.windows.getAll()).find(w => w.id === 2).focused, true);
  await assert.rejects(() => activateFinderTab(browser, 999));
  await assert.rejects(() => activateFinderTab(browser, '1'));
  await assert.rejects(() => activateFinderTab(browser, -1));
});
