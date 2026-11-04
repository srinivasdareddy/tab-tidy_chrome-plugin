const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');

async function until(read, expected) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const actual = await read();
    if (actual === expected) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(await read(), expected);
}

async function showAllOpenTabs(page) {
  while (await page.locator('#show-more-open').isVisible()) await page.locator('#show-more-open').click();
}

async function main() {
  const extensionPath = path.resolve(__dirname, '..');
  const extensionId = [...createHash('sha256').update(extensionPath).digest('hex').slice(0, 32)]
    .map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html lang="en"><title>Tab Tidy fixture</title><h1>Test page</h1></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(path.join(tmpdir(), 'tab-tidy-browser-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      viewport: { width: 420, height: 600 },
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const count = () => page.locator('#duplicate-count').textContent();
    const badge = () => page.evaluate(() => chrome.action.getBadgeText({}));
    const tabs = () => page.evaluate(() => chrome.tabs.query({}));
    await until(() => page.locator('#auto-arrange-domains').isChecked(), true);
    const siblings = await page.evaluate(async base => {
      const window = await chrome.windows.create({ url: 'about:blank', focused: false });
      const a = await chrome.tabs.create({ windowId: window.id, url: `${base}/sibling-one`, active: false });
      const b = await chrome.tabs.create({ windowId: window.id, url: `${base.replace('127.0.0.1', 'localhost')}/other-domain`, active: false });
      const c = await chrome.tabs.create({ windowId: window.id, url: `${base}/sibling-two`, active: false });
      return { windowId: window.id, ids: [a.id, b.id, c.id] };
    }, base);
    const siblingOrder = () => page.evaluate(async ({ windowId, ids }) => (await chrome.tabs.query({ windowId })).filter(t => ids.includes(t.id)).sort((a, b) => a.index - b.index).map(t => t.id).join(','), siblings);
    const [a, b, c] = siblings.ids;
    await until(siblingOrder, [a, c, b].join(','));
    await page.locator('#auto-arrange-domains').uncheck();
    await until(() => page.evaluate(async () => (await chrome.storage.local.get('autoArrangeDomains')).autoArrangeDomains), false);
    await page.reload();
    await until(() => page.locator('#arrange-domains').isEnabled(), true);
    assert.equal(await page.locator('#auto-arrange-domains').isChecked(), false);
    await page.evaluate(async id => { await chrome.tabs.move(id, { index: 3 }); }, c);
    assert.equal(await siblingOrder(), [a, b, c].join(','));
    await page.locator('#arrange-domains').click();
    await until(siblingOrder, [a, c, b].join(','));
    await until(() => page.locator('#arrange-domains').isEnabled(), true);
    assert.match(await page.locator('#status').textContent(), /Moved 1 tab/);
    await page.evaluate(async id => { await chrome.tabs.move(id, { index: 3 }); }, c);
    await page.locator('#auto-arrange-domains').check();
    await until(siblingOrder, [a, c, b].join(','));
    const boundary = await page.evaluate(async windowId => (await chrome.tabs.create({ windowId, index: 2, url: 'about:blank', active: false })).id, siblings.windowId);
    await until(() => page.evaluate(async id => (await chrome.tabs.get(id)).status, boundary), 'complete');
    await page.evaluate(async id => { await chrome.tabs.move(id, { index: 4 }); }, c);
    assert.equal(await siblingOrder(), [a, b, c].join(','));
    await page.evaluate(async id => { await chrome.tabs.remove(id); }, boundary);
    await until(siblingOrder, [a, c, b].join(','));
    await page.evaluate(async id => { await chrome.tabs.remove((await chrome.tabs.query({ windowId: id })).map(t => t.id)); }, siblings.windowId);
    console.log('PASS: default-on domain siblings, saved opt-out, manual grouping with automatic off, enable/removed-boundary arrangement.');
    const fixture = await page.evaluate(async base => {
      const a = `${base}/project?q=cat#one`;
      const b = `${base}/design`;
      const keeper = await chrome.tabs.create({ url: a, pinned: true, active: false });
      await chrome.tabs.create({ url: a, active: false });
      const otherWindow = await chrome.windows.create({ url: a, focused: false });
      await chrome.tabs.create({ url: b, active: false });
      await chrome.tabs.create({ url: b, active: false });
      await chrome.tabs.create({ url: `${a}#unique`, active: false });
      return { a, b, keeperId: keeper.id, secondWindowId: otherWindow.id };
    }, base);
    await until(count, '3');
    await until(badge, '3');
    await page.locator('.close-tab').first().click();
    await until(count, '2');
    await page.locator('#close-all').click();
    await until(count, '0');
    await until(badge, '');
    assert.equal(await page.locator('#undo-count').textContent(), '2');
    assert.equal((await tabs()).filter(t => t.url === fixture.a).length, 1);
    assert.equal((await tabs()).find(t => t.url === fixture.a).id, fixture.keeperId);
    await page.reload();
    await until(() => page.locator('#undo-cleanup').isVisible(), true);
    await page.locator('#undo-cleanup').click();
    await until(count, '2');
    assert.equal(await page.locator('#undo-cleanup').isVisible(), false);
    const restored = await tabs();
    assert.equal(restored.filter(t => t.url === fixture.a).length, 2);
    assert.equal(restored.filter(t => t.url === fixture.b).length, 2);
    assert.equal(restored.filter(t => t.url === `${fixture.a}#unique`).length, 1);
    assert.equal(restored.some(t => t.url === fixture.a && t.windowId !== fixture.secondWindowId && t.windowId !== restored.find(t => t.id === fixture.keeperId).windowId), true);
    await page.locator('#close-all').click();
    await until(count, '0');
    console.log('PASS: exact scan, live badge, individual/all close, Undo after reopening popup, missing-window recreation, pins and fragments.');

    const smart = await page.evaluate(async base => {
      const clean = `${base}/smart?q=cat#one`;
      const tracked = `${base}/smart?utm_source=email&q=cat&fbclid=123#one`;
      await chrome.tabs.create({ url: clean, active: false });
      await chrome.tabs.create({ url: tracked, active: false });
      await chrome.tabs.create({ url: `${base}/smart?q=dog#one`, active: false });
      await chrome.tabs.create({ url: `${base}/smart?q=cat#two`, active: false });
      return { clean, tracked };
    }, base);
    await until(async () => (await tabs()).filter(t => t.url?.startsWith(`${base}/smart`) && t.status === 'complete').length, 4);
    assert.equal(await count(), '0');
    await page.locator('#smart-matching').check();
    await until(count, '1');
    await until(badge, '1');
    await page.reload();
    await until(() => page.locator('#smart-matching').isChecked(), true);
    await until(count, '1');
    await page.locator('#close-all').click();
    await until(count, '0');
    await page.locator('#undo-cleanup').click();
    await until(count, '1');
    assert.equal((await tabs()).filter(t => t.url === smart.tracked).length, 1);
    assert.equal((await tabs()).filter(t => t.url === smart.clean).length, 1);
    await page.screenshot({ path: path.join(extensionPath, 'popup-preview.png') });
    const axe = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
    console.log('PASS: optional smart matching, saved preference, original URL restored, meaningful parameters preserved, accessibility.');
    await page.evaluate(() => {
      // Slow settings persistence makes a rapid toggle-and-close race deterministic.
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async update => {
        await new Promise(resolve => setTimeout(resolve, 100));
        await original(update);
        chrome.storage.local.set = original;
      };
      document.getElementById('smart-matching').click();
      document.getElementById('close-all').click();
    });
    await until(count, '0');
    assert.equal((await tabs()).filter(t => t.url === smart.tracked || t.url === smart.clean).length, 2);
    console.log('PASS: changing matching mode blocks simultaneous cleanup until the new scan finishes.');

    const concurrentIds = await page.evaluate(async base => {
      const first = await chrome.tabs.create({ url: `${base}/concurrent`, active: false });
      const second = await chrome.tabs.create({ url: `${base}/concurrent`, active: false });
      return [first.id, second.id];
    }, base);
    await until(async () => (await tabs()).filter(t => concurrentIds.includes(t.id) && t.status === 'complete').length, 2);
    const concurrent = await page.evaluate(async ids => {
      const open = await chrome.tabs.query({});
      const [first, second] = ids.map(id => open.find(t => t.id === id));
      const results = await Promise.all([
        chrome.runtime.sendMessage({ type: 'close-duplicates', tabs: [first] }),
        chrome.runtime.sendMessage({ type: 'close-duplicates', tabs: [second] }),
      ]);
      return { results, count: (await chrome.tabs.query({})).filter(t => t.url === first.url).length };
    }, concurrentIds);
    assert.equal(concurrent.count, 1);
    assert.equal(concurrent.results.reduce((n, item) => n + item.result.closed, 0), 1);

    const ids = await page.evaluate(async base => {
      const result = [];
      for (let n = 0; n < 12; n++) result.push((await chrome.tabs.create({ url: `${base}/detached`, active: false })).id);
      return result;
    }, base);
    await until(async () => (await tabs()).filter(t => ids.includes(t.id) && t.status === 'complete').length, 12);
    await page.evaluate(async ids => {
      const selected = (await chrome.tabs.query({})).filter(t => ids.slice(1).includes(t.id));
      void chrome.runtime.sendMessage({ type: 'close-duplicates', tabs: selected });
    }, ids);
    await page.close();
    const worker = context.serviceWorkers()[0];
    await until(() => worker.evaluate(async url => (await chrome.tabs.query({})).filter(t => t.url === url).length, `${base}/detached`), 1);
    await until(() => worker.evaluate(() => chrome.action.getBadgeText({})), '');
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
    await until(() => reopened.locator('#undo-count').textContent(), '11');
    await reopened.locator('#undo-cleanup').click();
    await until(() => reopened.locator('#duplicate-count').textContent(), '11');
    console.log('PASS: concurrent requests keep one copy; cleanup, badge, and Undo work after the popup closes.');

    await reopened.locator('#duplicate-shield').check();
    await until(() => reopened.evaluate(async () => (await chrome.storage.local.get('shieldEnabled')).shieldEnabled), true);
    const shielded = await reopened.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, fixture.a);
    await until(async () => (await reopened.evaluate(() => chrome.tabs.query({}))).some(t => t.id === shielded), false);
    assert.equal((await reopened.evaluate(() => chrome.tabs.query({}))).some(t => t.id === fixture.keeperId), true);
    const blank = await reopened.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://newtab/', active: false })).id);
    await reopened.evaluate(async ({ id, url }) => { await chrome.tabs.update(id, { url }); }, { id: blank, url: fixture.a });
    await until(async () => (await reopened.evaluate(() => chrome.tabs.query({}))).some(t => t.id === blank), false);
    const ordinary = await reopened.evaluate(async base => (await chrome.tabs.create({ url: `${base}/ordinary`, active: false })).id, base);
    await until(() => reopened.evaluate(async id => (await chrome.tabs.get(id)).status, ordinary), 'complete');
    await until(() => reopened.evaluate(async id => !(await chrome.storage.session.get('shieldCandidates')).shieldCandidates?.[id], ordinary), true);
    await reopened.evaluate(async ({ id, url }) => { await chrome.tabs.update(id, { url }); }, { id: ordinary, url: fixture.a });
    await until(() => reopened.evaluate(async id => (await chrome.tabs.get(id)).url, ordinary), fixture.a);
    // Undo must deliberately recreate a duplicate even with Shield enabled.
    const beforeUndo = await reopened.evaluate(async base => {
      const selected = (await chrome.tabs.query({})).find(t => t.url === `${base}/detached`);
      const total = (await chrome.tabs.query({})).filter(t => t.url === selected.url).length;
      await chrome.runtime.sendMessage({ type: 'close-duplicates', tabs: [selected] });
      await chrome.runtime.sendMessage({ type: 'undo-cleanup' });
      return total;
    }, base);
    await until(() => reopened.evaluate(async url => (await chrome.tabs.query({})).filter(t => t.url === url && t.status === 'complete').length, `${base}/detached`), beforeUndo);
    console.log('PASS: Shield catches direct/blank-tab duplicate opens, preserves ordinary navigation, and respects intentional Undo.');

    const parkingIds = await reopened.evaluate(async base => {
      const first = await chrome.tabs.create({ url: `${base}/parking-one`, active: false });
      const second = await chrome.tabs.create({ url: `${base}/parking-two`, active: false });
      return [first.id, second.id];
    }, base);
    await until(() => reopened.evaluate(async ids => (await chrome.tabs.query({})).filter(t => ids.includes(t.id) && t.status === 'complete').length, parkingIds), 2);
    await reopened.locator('#show-parking').click();
    assert.equal(await reopened.locator('#park-age').inputValue(), '48');
    assert.equal(await reopened.locator('#park-inactive').isDisabled(), true);
    await reopened.locator('#open-tabs-details > summary').click();
    await showAllOpenTabs(reopened);
    await reopened.locator('#parkable-list .parked-row').filter({ hasText: `${base}/parking-one` }).getByRole('button', { name: /^Park / }).click();
    await until(() => reopened.locator('#shelf-count').textContent(), '1');
    await reopened.locator('#park-search').fill('no-such-parked-link');
    assert.equal(await reopened.locator('#parked-list .parked-row').count(), 0);
    await reopened.locator('#park-search').fill('parking-one');
    assert.equal(await reopened.locator('#parked-list .parked-row').count(), 1);
    await reopened.reload();
    await reopened.locator('#show-parking').click();
    await until(() => reopened.locator('#shelf-count').textContent(), '1');
    await reopened.locator('#open-tabs-details > summary').click();
    await showAllOpenTabs(reopened);
    await reopened.locator('#parkable-list .parked-row').filter({ hasText: `${base}/parking-two` }).getByRole('button', { name: /^Park / }).click();
    await until(() => reopened.locator('#shelf-count').textContent(), '2');
    await reopened.locator('#parked-list .parked-row').filter({ hasText: `${base}/parking-two` }).getByRole('button', { name: /^Delete/ }).click();
    await until(() => reopened.locator('#shelf-count').textContent(), '1');
    await reopened.screenshot({ path: path.join(extensionPath, 'parking-preview.png') });
    const parkingAxe = await new AxeBuilder({ page: reopened }).analyze();
    assert.deepEqual(parkingAxe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
    await reopened.locator('#parked-list .parked-row').getByRole('button', { name: /^Reopen/ }).click();
    await until(() => reopened.locator('#shelf-count').textContent(), '0');
    await until(() => reopened.evaluate(async url => (await chrome.tabs.query({})).filter(t => t.url === url && t.status === 'complete').length, `${base}/parking-one`), 1);
    await reopened.locator('#park-age').selectOption('0');
    await until(() => reopened.locator('#park-inactive').isEnabled(), true);
    await reopened.locator('#park-inactive').click();
    await until(async () => Number(await reopened.locator('#shelf-count').textContent()) > 0, true);
    assert.equal((await reopened.evaluate(() => chrome.tabs.query({}))).some(t => t.id === fixture.keeperId && t.pinned), true);
    console.log('PASS: two-day parking default, manual/bulk park, search, popup persistence, delete/reopen, pinned protection, and parking accessibility.');

    await reopened.evaluate(async () => {
      await chrome.storage.local.set({ parkedTabs: Array.from({ length: 12 }, (_, index) => ({
        id: `layout-${index}`, title: `Recurring Payments and Subscriptions ${'LongTitle'.repeat(12)} ${index}`,
        url: `https://example.test/${'very-long-unbroken-path'.repeat(20)}?source=${index}#${'fragment'.repeat(20)}`,
        parkedAt: Date.now() + index, windowId: 1, index,
      })) });
    });
    await until(() => reopened.locator('#shelf-count').textContent(), '12');
    const widths = await reopened.evaluate(() => {
      const main = document.querySelector('main');
      const row = document.querySelector('#parked-list .parked-row');
      return { scroll: main.scrollWidth, width: main.clientWidth, row: row.getBoundingClientRect().width };
    });
    assert.ok(widths.scroll <= widths.width + 1, `Horizontal overflow: ${JSON.stringify(widths)}`);
    assert.equal(await reopened.locator('#parked-list .parked-row').count(), 5);
    await reopened.locator('#show-more-parked').click();
    assert.equal(await reopened.locator('#parked-list .parked-row').count(), 10);
    const longRow = reopened.locator('#parked-list .parked-row').first();
    const collapsedHeight = await longRow.locator('.site-url').evaluate(node => node.clientHeight);
    await longRow.getByRole('button', { name: 'Show more', exact: true }).click();
    assert.ok(await longRow.locator('.site-url').evaluate(node => node.clientHeight) > collapsedHeight);
    await longRow.getByRole('button', { name: 'Show less', exact: true }).click();
    assert.equal(await longRow.locator('.site-url').evaluate(node => node.clientHeight), collapsedHeight);
    await reopened.locator('#park-search').fill('source=0#');
    assert.equal(await reopened.locator('#parked-list .parked-row').count(), 1);
    assert.equal(await reopened.locator('#show-more-parked').isVisible(), false);
    console.log('PASS: long titles/URLs wrap without horizontal scrolling; list and URL Show more controls expand correctly.');
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
