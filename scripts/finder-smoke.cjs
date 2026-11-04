const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');

async function until(read, expected) {
  for (let n = 0; n < 150; n++) {
    if (await read() === expected) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(await read(), expected);
}

(async () => {
  const extension = path.resolve(__dirname, '..');
  const id = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const unsafeTitle = '<img src=x onerror=alert(1)> · Ticket title';
  const server = http.createServer((request, response) => {
    const title = request.url === '/unsafe' ? unsafeTitle : request.url === '/long' ? `ENG-999 · ${'Long unbroken title '.repeat(14)}` : `ENG-${request.url.slice(1)} · Ticket ${request.url.slice(1)}`;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="en"><title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title><h1>Finder fixture</h1></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(path.join(tmpdir(), 'tab-tidy-finder-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      viewport: { width: 760, height: 600 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/popup.html`);
    const fixture = await page.evaluate(async base => {
      await chrome.storage.local.set({ autoArrangeDomains: false });
      const current = await chrome.windows.getCurrent();
      const ids = [];
      for (let n = 1; n <= 8; n++) ids.push((await chrome.tabs.create({ url: `${base}/${n}`, windowId: current.id, active: false })).id);
      const unsafe = await chrome.tabs.create({ url: `${base}/unsafe`, active: false });
      const long = await chrome.tabs.create({ url: `${base}/long`, active: false });
      const other = await chrome.windows.create({ url: `${base.replace('127.0.0.1', 'localhost')}/other`, focused: false });
      await chrome.tabs.update(ids[0], { active: true });
      return { ids, unsafe: unsafe.id, long: long.id, other: other.tabs[0].id, windowId: other.id };
    }, base);
    await until(() => page.evaluate(async ids => (await chrome.tabs.query({})).filter(t => ids.includes(t.id) && t.status === 'complete').length, [...fixture.ids, fixture.unsafe, fixture.long, fixture.other]), 11);
    assert.equal(await page.locator('#open-tab-finder').count(), 1, 'Finder launch button must exist');
    await page.locator('#open-tab-finder').click();
    const dialog = page.locator('#tab-finder');
    await until(() => dialog.isVisible(), true);
    await until(() => page.locator('#finder-tabs .finder-tab').count(), 10);
    assert.equal(await page.locator('#finder-domain-title').textContent(), '127.0.0.1');
    assert.equal(await page.locator('#finder-filter').isVisible(), false, 'Browse without typing');
    assert.equal(await page.locator('#finder-tabs img').count(), 0, 'Titles are text, never HTML');
    assert.ok((await page.locator('#finder-tabs').textContent()).includes(unsafeTitle));
    assert.equal(await page.locator('.finder-tab-title').filter({ hasText: 'ENG-999' }).evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, 'Long title is fully visible');
    await page.locator('#finder-domains button[aria-pressed="true"]').focus();
    const windowScroll = await page.evaluate(() => [scrollX, scrollY]);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#finder-domain-title').textContent(), 'Browser pages', 'Down selects the next domain');
    assert.equal(await page.locator('#finder-domains button[aria-pressed="true"]').evaluate(el => el === document.activeElement), true, 'Domain focus follows selection');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('#finder-domain-title').textContent(), '127.0.0.1', 'Up selects the previous domain');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#finder-domain-title').textContent(), 'All domains', 'Home selects the first domain');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('#finder-domain-title').textContent(), 'localhost', 'Up wraps to the last domain');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#finder-domain-title').textContent(), 'All domains', 'Down wraps to the first domain');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#finder-domain-title').textContent(), 'localhost', 'End selects the last domain');
    assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), windowScroll, 'Domain arrow keys do not scroll the window');
    await page.locator('#finder-domains button').filter({ hasText: '127.0.0.1' }).click();
    await page.locator('#finder-tabs .finder-tab').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#finder-tabs .finder-tab').nth(1).evaluate(el => el === document.activeElement), true);
    await page.locator('#finder-filter-toggle').click();
    await page.locator('#finder-filter').fill('ENG-8');
    await until(() => page.locator('#finder-tabs .finder-tab').count(), 1);
    await page.locator('#finder-filter').fill('missing-title');
    assert.equal(await page.locator('#finder-empty').isVisible(), true);
    await page.locator('#finder-filter-toggle').click();
    await until(() => page.locator('#finder-tabs .finder-tab').count(), 10);
    const focusRow = page.locator('#finder-tabs .finder-tab').nth(4);
    await focusRow.focus();
    const focusedId = await focusRow.getAttribute('data-finder-tab');
    const listScroll = await page.locator('#finder-tabs').evaluate(el => el.scrollTop);
    const newId = await page.evaluate(async base => (await chrome.tabs.create({ url: `${base}/new`, active: false })).id, base);
    await until(() => page.locator('#finder-tabs .finder-tab').count(), 11);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.finderTab), focusedId, 'Live refresh retains row focus');
    assert.equal(await page.locator('#finder-tabs').evaluate(el => el.scrollTop), listScroll, 'Live refresh retains scroll');
    await page.evaluate(async ({ id, url }) => chrome.tabs.update(id, { url }), { id: newId, url: `${base}/renamed` });
    await until(async () => (await page.locator('#finder-tabs').textContent()).includes('ENG-renamed'), true);
    await page.evaluate(id => chrome.tabs.remove(id), newId);
    await until(() => page.locator('#finder-tabs .finder-tab').count(), 10);
    const staleId = await page.evaluate(async base => (await chrome.tabs.create({ url: `${base}/stale`, active: false })).id, base);
    await until(() => page.locator('#finder-tabs .finder-tab').count(), 11);
    await page.evaluate(async id => {
      await chrome.tabs.remove(id);
      document.querySelector(`[data-finder-tab="${id}"]`)?.click();
    }, staleId);
    await until(async () => (await page.locator('#finder-status').textContent()).includes('Couldn’t switch tabs'), true);
    await until(() => page.locator('#finder-tabs .finder-tab').count(), 10);
    assert.equal(await page.locator('#finder-tabs .finder-tab:disabled').count(), 0, 'Closed-tab failure leaves finder usable');
    assert.equal(await page.evaluate(() => document.activeElement.matches('#finder-tabs .finder-tab, #finder-refresh')), true, 'Failed selection restores usable keyboard focus');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.matches('#finder-tabs .finder-tab')), true, 'Keyboard browsing continues after failure');
    await page.locator('#finder-domains button').filter({ hasText: 'All domains' }).click();
    assert.ok(await page.locator('#finder-tabs .finder-tab').count() >= 11);
    const axe = await new AxeBuilder({ page }).include('#tab-finder').analyze();
    assert.deepEqual(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
    await page.locator('#finder-domains button').filter({ hasText: 'localhost' }).click();
    const before = await page.evaluate(async () => (await chrome.tabs.query({})).map(t => [t.id, t.url]));
    await page.locator('#finder-tabs .finder-tab').click();
    await until(() => page.evaluate(async id => (await chrome.tabs.get(id)).active, fixture.other), true);
    assert.equal(await page.evaluate(async id => (await chrome.windows.get(id)).focused, fixture.windowId), true);
    assert.deepEqual(await page.evaluate(async () => (await chrome.tabs.query({})).map(t => [t.id, t.url])), before, 'Switching must not close or navigate tabs');
    await until(() => dialog.isVisible(), false);
    await page.locator('#open-tab-finder').click();
    await until(() => dialog.isVisible(), true);
    await page.locator('#finder-domains button').filter({ hasText: 'localhost' }).click();
    await page.evaluate(id => chrome.tabs.remove(id), fixture.other);
    await until(() => page.locator('#finder-domain-title').textContent(), 'All domains');
    await page.keyboard.press('Escape');
    await until(() => dialog.isVisible(), false);
    await until(() => page.evaluate(() => document.body.getBoundingClientRect().width), 420);
    assert.equal(await page.locator('#open-tab-finder').evaluate(el => el === document.activeElement), true, 'Escape returns focus');
    await page.locator('#open-tab-finder').click();
    await until(() => dialog.isVisible(), true);
    await page.locator('#finder-domains button').filter({ hasText: '127.0.0.1' }).click();
    const sizes = await page.evaluate(() => {
      const dialog = document.getElementById('tab-finder');
      const list = document.getElementById('finder-tabs');
      return { width: dialog.clientWidth, scrollWidth: dialog.scrollWidth, listWidth: list.clientWidth, listScrollWidth: list.scrollWidth, height: dialog.getBoundingClientRect().height };
    });
    assert.ok(sizes.scrollWidth <= sizes.width + 1 && sizes.listScrollWidth <= sizes.listWidth + 1, JSON.stringify(sizes));
    assert.ok(sizes.height <= 600, JSON.stringify(sizes));
    await page.screenshot({ path: path.join(extension, 'finder-preview.png') });
    assert.deepEqual(errors, []);
    const invalid = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'focus-tab', tabId: 'not-an-id' }));
    assert.ok(invalid.error);
    console.log('PASS: browse-first/current domain, full/escaped titles, optional filter, keyboard, live updates/removal, real cross-window focus, no navigation/closure, Escape/focus/size restoration, layout, accessibility, invalid selection.');
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
