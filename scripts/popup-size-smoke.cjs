const { chromium } = require('playwright');
const { createHash } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const extension = path.resolve(__dirname, '..');
  const id = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const profile = await mkdtemp(path.join(tmpdir(), 'tab-tidy-popup-size-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup.html`);
    const client = await context.newCDPSession(page);
    const current = (await client.send('Target.getTargetInfo')).targetInfo.targetId;
    await page.evaluate(() => chrome.action.openPopup());
    const targets = (await client.send('Target.getTargets')).targetInfos;
    const popup = targets.find(target => target.url === page.url() && target.targetId !== current);
    assert.ok(popup, 'Chrome must open the actual toolbar popup');
    const { sessionId } = await client.send('Target.attachToTarget', { targetId: popup.targetId, flatten: false });
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Popup measurement timed out')), 5000);
      client.on('Target.receivedMessageFromTarget', event => {
        if (event.sessionId !== sessionId) return;
        const payload = JSON.parse(event.message);
        if (payload.id === 1) { clearTimeout(timer); resolve(payload); }
      });
    });
    await client.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        viewport: innerWidth, body: document.body.getBoundingClientRect().width,
        root: document.documentElement.getBoundingClientRect().width,
        scroll: document.querySelector('main').scrollWidth, client: document.querySelector('main').clientWidth
      }))))`, awaitPromise: true, returnByValue: true,
    } }) });
    const payload = await response;
    const size = payload.result?.result?.value;
    assert.ok(size, JSON.stringify(payload));
    console.log('Actual toolbar popup:', size);
    // Chrome may reserve a native scrollbar gutter beside the fixed content.
    assert.ok(size.viewport >= 420 && size.viewport <= 440);
    assert.equal(size.body, 420);
    assert.equal(size.root, 420);
    assert.ok(size.scroll <= size.client + 1, 'Popup content must not overflow horizontally');
    await page.setViewportSize({ width: 160, height: 600 });
    assert.equal(await page.evaluate(() => document.body.getBoundingClientRect().width), 420);
    console.log('PASS: real toolbar content is 420px; a narrow initial viewport cannot shrink it.');
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
