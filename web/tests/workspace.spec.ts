import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const base = Date.UTC(2024, 0, 1);
const intervals: Record<string, number> = { '1': 60_000, '5': 300_000, '15': 900_000, '60': 3_600_000, '240': 14_400_000, D: 86_400_000, W: 604_800_000 };
const tradeId = (index: number) => String(index).repeat(64);
const trades = [1, 2, 3].map((index) => ({ id: tradeId(index), sequence: index, instrument: 'BTC-USDT-SWAP', direction: '多',
  leverage: 10, margin: 100, entryPrice: 100, exitPrice: 102, profit: index * 10, returnRate: 10,
  turnover: 100, size: 1, maxPositionValue: 100, fee: 1, entryTime: new Date(base + index * 86_400_000).toISOString(),
  exitTime: new Date(base + index * 86_400_000 + 3_600_000).toISOString(), holdingMinutes: 60, amplitude: 1, sourceNote: '原始备注' }));
const positions = trades.map((trade, index) => ({ venue: index === 1 ? 'gate' : 'bitget', positionId: String(index + 1),
  unifiedSymbol: 'BTC/USDT:USDT', chartSymbol: 'BTCUSDT', side: 'long', status: 'closed', entryPrice: 100,
  exitPrice: 102, contracts: 1, leverage: 10, marginMode: 'cross', hedged: false, realizedPnl: 10, netPnl: 9,
  funding: 0, openFee: 0.5, closeFee: 0.5, entryTimeMs: Date.parse(trade.entryTime), exitTimeMs: Date.parse(trade.exitTime),
  note: index === 1 ? '仓位已保存笔记' : '', tagIds: index === 0 ? [1] : [], fills: [] }));

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Failed requests remain visible as test failures rather than silent toasts.
  page.on('response', (response) => { if (response.status() >= 500) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  (page as Page & { regressionErrors?: string[] }).regressionErrors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { regressionErrors?: string[] }).regressionErrors).toEqual([]);
});

async function mockApi(page: Page, requests: string[] = []) {
  await page.route('**/bitlang-trades.json', (route) => route.fulfill({ json: { source: 'fixture', generatedAt: new Date(base).toISOString(), trades } }));
  await page.route('**/videos.json*', (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\//, async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const params = url.searchParams;
    if (!path.startsWith('/api/')) { await route.continue(); return; }
    requests.push(path);
    let response: unknown;
    if (path === '/api/symbols' || path === '/api/cfd/symbols') response = { symbols: [{ symbol: path.includes('cfd') ? 'XAUUSD' : 'BTCUSDT', name: 'fixture' }] };
    else if (path === '/api/chart/config') response = { offlineMode: false };
    else if (path === '/api/paper-trades') response = { trades: [] };
    else if (path === '/api/state') response = { records: {} };
    else if (path === '/api/videos/source') response = { url: '', total: 0 };
    else if (path === '/api/settings') response = { invites: { gate: '', bitget: '' } };
    else if (path === '/api/performance') response = { capacity: 200, samples: [] };
    else if (path === '/api/bitlang-review') response = { notes: { [tradeId(2)]: '已保存复盘笔记' }, tags: [{ id: 1, name: '趋势', color: '#3b82f6' }], tagMap: { [tradeId(1)]: [1] } };
    else if (path.endsWith('/drawings')) {
      const id = params.get('tradeId') || params.get('positionId') || 'global';
      response = { drawings: [{ id: `line-${id}`, symbol: params.get('symbol'), interval: '15', toolType: 'TrendLine',
        points: [{ timestamp: base + 86_400_000, price: 100 }, { timestamp: base + 86_400_000 + 3_600_000, price: 101 }], options: { text: `画线 ${id}` } }] };
    } else if (path.endsWith('/candles')) {
      const step = intervals[params.get('interval') || '15'];
      const requestedAnchor = Number(params.get('replayCursor') || params.get('anchor') || params.get('entry') || base);
      const anchor = params.has('anchor') ? Math.min(requestedAnchor, Date.now() - 1000 * step) : requestedAnchor;
      const count = params.has('before') || params.has('after') ? Number(params.get('limit') || 1000) : 1000;
      const start = params.has('before') ? Number(params.get('before')) - count * step
        : params.has('after') ? Number(params.get('after')) + step : Math.floor(anchor / step) * step - 500 * step;
      const candles = Array.from({ length: count }, (_, index) => ({ timestamp: start + index * step, open: 100, high: 102, low: 99, close: 101, volume: 10 }));
      response = { candles, source: path.includes('cfd') ? 'gate-cfd' : 'sqlite', volumeAvailable: !path.includes('cfd'), candleVenue: 'bybit' };
    } else if (path === '/api/position-review') response = { configured: false, venues: { bitget: false, gate: false }, syncedAt: null, balance: null, positions, tags: [{ id: 1, name: '趋势', color: '#3b82f6' }] };
    else throw new Error(`Unexpected fixture API: ${request.method()} ${path}`);
    await route.fulfill({ json: response });
  });
}

test('long replay with real chart remains bounded, keeps viewport and reloads an evicted rewind edge', async ({ page }) => {
  await mockApi(page);
  await page.route('**/__retention_test', (route) => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script><script type="module" src="/tests/retention-harness.tsx"></script>` }));
  await page.goto('/__retention_test');
  const state = page.locator('#state');
  await expect(state).toHaveAttribute('data-count', '1000');
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const heapBytes = async () => {
    await session.send('HeapProfiler.collectGarbage');
    const { metrics } = await session.send('Performance.getMetrics');
    return metrics.find((item) => item.name === 'JSHeapUsedSize')!.value;
  };
  let warmHeapBytes = 0;
  const started = Date.now();
  const extensions = 60;
  for (let index = 0; index < extensions; index++) {
    const last = Number(await state.getAttribute('data-last'));
    await page.locator('#reveal').click();
    await expect(state).toHaveAttribute('data-anchor', String(last + 60_000 - 120 * 60_000));
    const anchor = await state.getAttribute('data-anchor');
    await page.locator('#prefetch').click();
    await expect.poll(async () => Number(await state.getAttribute('data-last'))).toBeGreaterThan(last);
    expect(Number(await state.getAttribute('data-count'))).toBeLessThanOrEqual(12_000);
    await expect(state).toHaveAttribute('data-anchor', anchor!);
    if (index === 47) warmHeapBytes = await heapBytes();
  }
  const performancePath = test.info().outputPath('replay-performance.json');
  await writeFile(performancePath, JSON.stringify({
    extensions, activeCandles: Number(await state.getAttribute('data-count')), durationMs: Date.now() - started,
    warmHeapBytes, finalHeapBytes: await heapBytes(),
  }, null, 2));
  await test.info().attach('replay-performance.json', { contentType: 'application/json', path: performancePath });
  expect(Number(await state.getAttribute('data-first'))).toBeGreaterThan(base);
  const edgeCursor = Number(await state.getAttribute('data-first')) + 60_000;
  await page.locator('#edge').click();
  await expect(state).toHaveAttribute('data-cursor', String(edgeCursor));
  const cursor = Number(await state.getAttribute('data-cursor'));
  await page.locator('#rewind').click();
  await expect(state).toHaveAttribute('data-cursor', String(cursor - 60_000));
  expect(Number(await state.getAttribute('data-count'))).toBeLessThanOrEqual(12_000);
});

test('ArrowRight starts replay, bookmarks restore in their market and CFD has no paper requests', async ({ page }) => {
  const requests: string[] = [];
  await mockApi(page, requests);
  await page.goto('/?tab=review');
  await expect(page.getByRole('button', { name: '添加时间书签' })).toBeEnabled();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('自由复盘', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加时间书签' }).click();
  await expect(page.getByLabel('回放时间书签').locator('option')).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel('回放时间书签').locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: '全球市场', exact: true }).click();
  requests.length = 0;
  await expect(page.getByRole('button', { name: '添加时间书签' })).toBeEnabled();
  await expect(page.getByLabel('回放时间书签').locator('option')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /模拟交易/ })).toHaveCount(0);
  await expect(page.getByText('成交量', { exact: true })).toHaveCount(0);
  expect(requests).not.toContain('/api/paper-trades');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('自由复盘', { exact: true })).toBeVisible();
});

test('pending review filter persists; exports saved notes and drawing scopes survive timeframe changes', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?tab=bitlang');
  const rows = page.locator('.bitlang-trade-row');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: '待复盘', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: '待复盘', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await page.locator(`[data-review-id="${tradeId(2)}"]`).click();
  await expect(page.getByRole('button', { name: '导出复盘卡片' })).toBeEnabled();
  await page.getByTitle('画图图层对象树', { exact: true }).click();
  await expect(page.locator('.tree-item-label')).toHaveText(`画线 ${tradeId(2)}`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出复盘卡片' }).click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, 'utf8');
  expect(html).toContain('已保存复盘笔记'); expect(html).toContain('data:image/png;base64,'); expect(html).toContain('原始备注');
  await page.getByRole('button', { name: '1h', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出复盘卡片' })).toBeEnabled();
  await page.getByTitle('画图图层对象树', { exact: true }).click();
  await expect(page.locator('.tree-item-label')).toHaveText(`画线 ${tradeId(2)}`);
  await page.locator(`[data-review-id="${tradeId(1)}"]`).click();
  await page.getByTitle('画图图层对象树', { exact: true }).click();
  await expect(page.locator('.tree-item-label')).toHaveText(`画线 ${tradeId(1)}`);
  await page.getByTitle('关闭对象树', { exact: true }).click();
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await expect(page.getByLabel('相邻时段对比')).toBeVisible();
});

test('five entries, themes and position review queue/card/diagnostics remain usable', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '顺序学习', exact: true })).toHaveClass(/active/);
  await page.getByRole('button', { name: '切换到亮色主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  for (const name of ['行情复盘', '全球市场', 'bit浪浪实盘分析', '仓位复盘']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveClass(/active/);
  }
  const rows = page.locator('[data-review-id]');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: '待复盘', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: '待复盘', exact: true }).click();
  await page.locator('[data-review-id="gate::2"]').click();
  await expect(page.getByRole('button', { name: '导出复盘卡片' })).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出复盘卡片' }).click();
  const html = await readFile((await (await downloaded).path())!, 'utf8');
  expect(html).toContain('仓位已保存笔记'); expect(html).toContain('Gate BTCUSDT');
  await page.getByRole('button', { name: '切换到暗色主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '刷新性能记录', exact: true }).click();
  await expect(page.locator('.performance-table')).toContainText('GET /api/position-review');
  await page.screenshot({ path: test.info().outputPath('settings-performance.png') });
});
