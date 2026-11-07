const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

(async () => {
  const extension = path.resolve(__dirname, '..');
  const id = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const profile = await mkdtemp(path.join(tmpdir(), 'finder-keyboard-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      reducedMotion: 'reduce',
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup.html?view=finder`);
    const ids = await page.evaluate(async () => {
      const ids = [];
      for (const title of ['Alpha', 'Beta']) {
        ids.push((await chrome.tabs.create({ url: `data:text/html,<title>KeyboardFixture ${title}</title>`, active: false })).id);
      }
      return ids;
    });
    await page.waitForFunction(() => document.querySelector('#finder-tabs')?.textContent.includes('KeyboardFixture Beta'));
    const filter = page.locator('#finder-filter');
    const rows = page.locator('#finder-tabs button');
    for (const query of ['KeyboardFixture', 'KeyboardFixture Beta']) {
      await filter.fill(query);
      const normalBackground = await rows.first().evaluate(el => getComputedStyle(el).backgroundColor);
      await page.keyboard.press('ArrowDown');
      assert.equal(await rows.first().evaluate(el => el === document.activeElement), true, `${query}: Down focuses first result`);
      const style = await rows.first().evaluate(el => {
        const css = getComputedStyle(el);
        return { background: css.backgroundColor, offset: parseFloat(css.outlineOffset), width: parseFloat(css.outlineWidth) };
      });
      assert.ok(style.width > 0 && style.offset <= -style.width, 'Focused row outline stays inside the scroll container');
      assert.notEqual(style.background, normalBackground, 'Focused row has a visible background highlight');
      if (query === 'KeyboardFixture') {
        await page.keyboard.press('ArrowDown');
        assert.equal(await rows.nth(1).evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('ArrowUp');
        assert.equal(await rows.first().evaluate(el => el === document.activeElement), true);
      }
    }
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('tab-finder').open);
    assert.equal(await page.evaluate(async id => (await chrome.tabs.get(id)).active, ids[1]), true, 'Enter switches to the only matching tab');
    await page.locator('#open-tab-finder').click();
    await filter.fill('missing-keyboard-fixture');
    await page.keyboard.press('ArrowDown');
    assert.equal(await filter.evaluate(el => el === document.activeElement), true, 'No results retains search focus');
    console.log('PASS: single/multiple results, visible inset focus/highlight, Up/Down, Enter activation, empty results.');
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
