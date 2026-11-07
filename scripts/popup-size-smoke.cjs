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
    await page.goto(`chrome-extension://${id}/popup.html?view=finder`);
    await page.waitForFunction(() => document.getElementById('tab-finder').open, null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'finder-filter', 'Shortcut launch focuses search');
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
    for (const [commandId, action, width] of [
      [2, "document.getElementById('open-tab-finder').focus(); document.getElementById('open-tab-finder').click()", 760],
      [3, "document.getElementById('finder-close').click()", 420],
    ]) {
      const reply = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { client.off('Target.receivedMessageFromTarget', listener); reject(new Error('Finder sizing timed out')); }, 5000);
        const listener = event => {
          if (event.sessionId !== sessionId) return;
          const result = JSON.parse(event.message);
          if (result.id !== commandId) return;
          clearTimeout(timer);
          client.off('Target.receivedMessageFromTarget', listener);
          resolve(result);
        };
        client.on('Target.receivedMessageFromTarget', listener);
      });
      await client.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: commandId, method: 'Runtime.evaluate', params: {
        expression: `(async () => { ${action}; await new Promise(resolve => setTimeout(resolve, 300));
          const dialog = document.getElementById('tab-finder'); const rect = dialog.getBoundingClientRect();
          return { viewport: innerWidth, height: innerHeight, body: document.body.getBoundingClientRect().width,
            open: dialog.open, left: rect.left, right: rect.right, bottom: rect.bottom,
            active: document.activeElement.id, scroll: dialog.scrollWidth, client: dialog.clientWidth };
        })()`, awaitPromise: true, returnByValue: true,
      } }) });
      const result = await reply;
      const measured = result.result?.result?.value;
      assert.ok(measured, JSON.stringify(result));
      console.log('Finder toolbar popup:', measured);
      assert.equal(measured.body, width);
      assert.ok(measured.viewport >= width && measured.viewport <= width + 20);
      assert.equal(measured.open, width === 760);
      if (measured.open) {
        assert.ok(measured.left >= 0 && measured.right <= measured.viewport && measured.bottom <= measured.height, 'Finder must fit actual toolbar bounds');
        assert.ok(measured.scroll <= measured.client + 1, 'Finder must not overflow horizontally');
      } else assert.equal(measured.active, 'open-tab-finder', 'Close restores launcher focus');
    }
    await page.setViewportSize({ width: 160, height: 600 });
    assert.equal(await page.evaluate(() => document.body.getBoundingClientRect().width), 420);
    await client.send('Target.closeTarget', { targetId: popup.targetId });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    assert.ok(commands.some(command => command.name === 'open-tab-finder' && command.shortcut), 'Finder shortcut must register in Chrome');
    await page.evaluate(async () => {
      const { handleCommand } = await import(chrome.runtime.getURL('finder-shortcut.js'));
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await handleCommand('open-tab-finder', tab);
      const popup = await chrome.action.getPopup({ tabId: tab.id });
      if (popup !== chrome.runtime.getURL('popup.html')) throw new Error('Shortcut must restore normal toolbar popup');
    });
    const finderPopup = (await client.send('Target.getTargets')).targetInfos.find(target => target.url.endsWith('/popup.html?view=finder'));
    assert.ok(finderPopup, 'Command must open an actual finder toolbar popup');
    console.log('PASS: actual toolbar stays 420px, expands to 760px for finder, restores size/focus on close, and fits all content.');
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
