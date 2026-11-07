// Uses the existing local frontend; every API request is intercepted in an isolated context.
// Run: node --test web/tests/review-sessions.check.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function until(check, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(message);
}

async function fixture(market = 'perpetual') {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const sessions = new Map();
  const publicDrawings = [];
  const requests = [];
  const errors = [];
  const cursor = Date.parse('2024-01-02T10:15:00+08:00');
  const symbol = market === 'cfd' ? 'XAUUSD' : 'BTCUSDT';
  const flags = { failDrawing: false, failMetadata: false };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const raw = ({ id, toolType, interval, points, options }) => ({ id, toolType, interval, points, options });
  const detail = (record) => {
    const { drawings, ...metadata } = record;
    return { ...clone(metadata), drawingCount: drawings.length };
  };
  const summary = (record) => {
    const { state, ...metadata } = detail(record);
    return { ...metadata, timeframe: state.timeframe, timestampMs: state.timestampMs };
  };
  await context.addInitScript(({ market, cursor }) => {
    const key = market === 'cfd' ? 'tiabtc-cfd-location-v1' : 'tiabtc-review-location-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      timeframe: '60', timestampMs: cursor, visibleSpan: 120,
      replay: { startTimeMs: cursor - 900000, cursorTimeMs: cursor, speed: 1 },
    }));
  }, { market, cursor });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = route.request().method();
    requests.push({ path: url.pathname, method });
    const body = method === 'POST' || method === 'PUT' ? route.request().postDataJSON() : null;
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === '/api/review-sessions') {
      if (method === 'GET') return send({ sessions: [...sessions.values()]
        .filter((item) => item.market === url.searchParams.get('market')).reverse().map(summary) });
      const id = `session-${sessions.size + 1}`;
      const now = new Date().toISOString();
      const record = {
        id, title: `${body.state.symbol} 复盘 ${sessions.size + 1}`, market: body.market,
        symbol: body.state.symbol, state: clone(body.state), drawings: (body.drawings || []).map(raw),
        createdAt: now, updatedAt: now,
      };
      sessions.set(id, record);
      return send(detail(record));
    }
    if (url.pathname.startsWith('/api/review-sessions/')) {
      const [id, resource] = url.pathname.slice('/api/review-sessions/'.length).split('/');
      const record = sessions.get(id);
      if (!record) return send({ error: '复盘档案不存在' }, 404);
      if (!resource) {
        if (method === 'GET') return send(detail(record));
        if (flags.failMetadata) return send({ error: '模拟档案保存失败' }, 500);
        if (body.state) {
          assert.equal(body.state.symbol, record.symbol);
          record.state = clone(body.state);
        }
        if (body.title) record.title = body.title;
        return send(detail(record));
      }
      assert.equal(resource, 'drawings');
      if (method === 'GET') return send({ drawings: clone(record.drawings) });
      if (flags.failDrawing) return send({ error: '模拟画图保存失败' }, 500);
      if (method === 'POST') {
        assert.equal(body.symbol, record.symbol);
        const index = record.drawings.findIndex((item) => item.id === body.id);
        if (index < 0) record.drawings.push(raw(body)); else record.drawings[index] = raw(body);
        return send(raw(body));
      }
      if (method === 'PUT') { record.drawings = body.drawings.map(raw); return send({ drawings: clone(record.drawings) }); }
      if (method === 'DELETE') {
        record.drawings = url.searchParams.has('id')
          ? record.drawings.filter((item) => item.id !== url.searchParams.get('id')) : [];
        return send({ ok: true });
      }
    }
    if (url.pathname.includes('symbols')) return send({ symbols: [{ symbol }] });
    if (url.pathname.endsWith('/config')) return send({ offlineMode: false });
    if (url.pathname.endsWith('/candles')) {
      const params = url.searchParams;
      const interval = params.get('interval');
      const step = { '1': 1, '5': 5, '15': 15, '60': 60, '240': 240, D: 1440, W: 10080 }[interval] * 60000;
      const anchor = Number(params.get('replayCursor') || params.get('anchor') || cursor);
      const aligned = Math.floor(anchor / step) * step;
      const rows = [];
      const from = params.has('cutoff') ? Number(params.get('after')) + 1 : aligned - 120 * step;
      const end = params.has('cutoff') ? Number(params.get('cutoff')) : aligned + 240 * step;
      for (let time = from; market === 'cfd' && params.has('cutoff') ? time + step <= end : time <= end; time += step) {
        rows.push({ timestamp: time, open: 100, high: 110, low: 90, close: 105, volume: 7 });
      }
      return send({ candles: rows });
    }
    if (url.pathname.endsWith('/drawings')) {
      if (method === 'GET') return send({ drawings: clone(publicDrawings) });
      if (method === 'POST') { publicDrawings.push(raw(body)); return send(raw(body)); }
    }
    if (url.pathname.includes('paper-trades')) return send({ trades: [] });
    return send({});
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:3000/?tab=${market === 'cfd' ? 'cfd' : 'review'}`, { waitUntil: 'domcontentloaded' });
  await until(async () => !(await page.getByTitle('向上箭头', { exact: true }).isDisabled()), 'drawing workspace did not become ready');
  await page.locator('[aria-label="距当前周期收盘 45:00"]').waitFor();
  await page.waitForTimeout(150);
  return { page, context, sessions, publicDrawings, requests, errors, cursor, flags };
}

async function panel(page) {
  if (!(await page.locator('.review-archives').evaluate((node) => node.open))) {
    await page.locator('.review-archives > summary').click();
  }
}

async function draw(page, offset = 0) {
  await page.getByTitle('向上箭头', { exact: true }).click();
  const box = await page.locator('.chart-drawing-overlay').boundingBox();
  // Stay on historical candles; future whitespace can leave a smaller
  // timeframe's replay viewport after reopening the archive.
  await page.mouse.click(box.x + box.width * 0.6 + offset, box.y + box.height * 0.33);
}

async function rename(page, name) {
  await page.getByLabel('复盘档案名称', { exact: true }).waitFor({ state: 'attached' });
  await panel(page);
  await page.getByLabel('复盘档案名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
}

test('archive restores editable drawings, timeframe, cursor, and supports delete/undo', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const { page, sessions } = f;
    await draw(page);
    await until(() => f.publicDrawings.length === 1, 'legacy drawing was not saved');
    await panel(page);
    await page.getByRole('button', { name: '保存本次复盘', exact: true }).click();
    await until(() => sessions.size === 1, 'archive not created');
    await until(async () => await page.getByTitle('向上箭头', { exact: true }).isEnabled(), 'archive drawings not ready');
    await rename(page, 'BTC 第一次复盘');
    await until(() => sessions.get('session-1').title === 'BTC 第一次复盘', 'rename failed');
    assert.equal(sessions.get('session-1').drawings.length, 1);
    const originalPrice = sessions.get('session-1').drawings[0].points[0].price;
    const mark = page.locator('.chart-drawing-overlay > g[pointer-events="all"] > text').first();
    await mark.waitFor();
    const box = await mark.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 40, { steps: 5 });
    await page.mouse.up();
    await until(() => sessions.get('session-1').drawings[0].points[0].price !== originalPrice, 'editing did not persist');
    const editedPrice = sessions.get('session-1').drawings[0].points[0].price;
    await page.getByRole('button', { name: '15m', exact: true }).click();
    await until(() => sessions.get('session-1').state.timeframe === '15', 'timeframe not saved');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => await page.locator('.chart-drawing-overlay > g[pointer-events="all"] > text').count() === 1, 'drawing missing after reload');
    assert.equal(sessions.get('session-1').drawings[0].points[0].price, editedPrice);
    assert.equal(sessions.get('session-1').state.replay.cursorTimeMs, f.cursor);
    assert.match(await page.locator('.free-replay-controls').innerText(), /自由复盘/);
    await page.locator('.chart-drawing-overlay > g[pointer-events="all"] > text').click();
    await page.keyboard.press('Delete');
    await until(() => sessions.get('session-1').drawings.length === 0, 'drawing delete not persisted');
    await page.keyboard.press('Control+z');
    await until(() => sessions.get('session-1').drawings.length === 1, 'drawing undo not persisted');
    assert.equal(f.publicDrawings.length, 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});

for (const market of ['perpetual', 'cfd']) {
  test(`${market}: archives are isolated, can be reopened, and failed saves keep the active archive`, { timeout: 60000 }, async () => {
    const f = await fixture(market);
    try {
      const { page, sessions } = f;
      await panel(page);
      await page.getByRole('button', { name: '保存本次复盘', exact: true }).click();
      await until(() => sessions.size === 1, 'first archive not created');
      await until(async () => await page.getByTitle('向上箭头', { exact: true }).isEnabled(), 'archive not ready');
      await draw(page);
      await until(() => sessions.get('session-1').drawings.length === 1, 'first drawing missing');
      await panel(page);
      await page.getByRole('button', { name: '新建复盘', exact: true }).click();
      await until(() => sessions.size === 2, 'second archive not created');
      assert.equal(sessions.get('session-2').drawings.length, 0);
      await until(async () => await page.getByTitle('向上箭头', { exact: true }).isEnabled(), 'second archive not ready');
      await draw(page, 60);
      await until(() => sessions.get('session-2').drawings.length === 1, 'second drawing missing');
      await panel(page);
      await page.getByLabel('打开复盘档案', { exact: true }).selectOption('session-1');
      await until(async () => await page.getByTitle('向上箭头', { exact: true }).isEnabled(), 'reopened archive not ready');
      assert.equal(sessions.get('session-1').drawings.length, 1);
      assert.notEqual(sessions.get('session-1').drawings[0].id, sessions.get('session-2').drawings[0].id);
      f.flags.failDrawing = true;
      await draw(page, 120);
      await page.getByText(/保存画图记录失败: 模拟画图保存失败/).waitFor();
      assert.equal(sessions.get('session-1').drawings.length, 1);
      f.flags.failDrawing = false;
      f.flags.failMetadata = true;
      await page.getByRole('button', { name: '15m', exact: true }).click();
      await panel(page);
      await page.getByLabel('打开复盘档案', { exact: true }).selectOption('session-2');
      await page.locator('.review-archives-error').getByText('模拟档案保存失败', { exact: false }).waitFor();
      assert.equal(await page.getByLabel('打开复盘档案', { exact: true }).inputValue(), 'session-1');
      f.flags.failMetadata = false;
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await until(() => sessions.get('session-1').state.timeframe === '15', 'retry did not save the latest state');
      assert.equal(f.publicDrawings.length, 0);
      if (market === 'cfd') assert.equal(f.requests.some((request) => request.path.includes('paper-trades')), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
}

test('starting replay creates an archive automatically and refresh resumes paused at the saved cursor', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const { page, sessions } = f;
    await page.getByTitle('退出自由回放', { exact: true }).click();
    await page.locator('.review-chart-loading').waitFor({ state: 'hidden' });
    // Starting at the live edge cannot advance until another candle closes.
    // Pan to an earlier position to exercise historical keyboard playback.
    const plot = await page.locator('.chart-canvas-price-pane').boundingBox();
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(plot.x + plot.width * 0.65, plot.y + plot.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await page.locator('.chart-readout-bar').click();
    await page.waitForTimeout(180);
    await page.keyboard.press('ArrowRight');
    await until(() => sessions.size === 1, 'starting replay did not create an archive');
    await until(async () => await page.locator('.free-replay-controls').count() === 1, 'archive did not enter replay');
    await page.waitForFunction(() => document.querySelector('.review-archives select')?.value === 'session-1');
    await page.locator('.review-chart-loading').waitFor({ state: 'hidden' });
    await page.waitForTimeout(100);
    const firstCursor = sessions.get('session-1').state.replay.cursorTimeMs;
    await page.keyboard.press('ArrowRight');
    await until(() => sessions.get('session-1').state.replay.cursorTimeMs > firstCursor, 'replay cursor not saved');
    const savedCursor = sessions.get('session-1').state.replay.cursorTimeMs;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.free-replay-controls').waitFor();
    assert.match(await page.locator('.free-replay-controls').innerText(), /自由复盘/);
    assert.equal(sessions.get('session-1').state.replay.cursorTimeMs, savedCursor);
    await panel(page);
    assert.equal(await page.getByLabel('打开复盘档案', { exact: true }).inputValue(), 'session-1');
    assert.equal(f.publicDrawings.length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.context.close(); }
});
