(function () {
  'use strict';

  const FIB_LEVELS = [0, 0.618, 0.66, 1];
  const INTERVAL_LABELS = { '5': '5 分钟', '15': '15 分钟', '60': '1 小时', '240': '4 小时', D: '日线', W: '周线' };
  const INTERVAL_SECONDS = { '5': 300, '15': 900, '60': 3600, '240': 14400, D: 86400, W: 604800 };
  const RIGHT_WHITESPACE_BARS = 500;
  const state = {
    initialized: false,
    video: null,
    symbol: 'BTCUSDT',
    interval: '60',
    futureDays: 3,
    chart: null,
    series: null,
    drawings: [],
    selectedId: '',
    tool: null,
    draftPoint: null,
    hoverPoint: null,
    drag: null,
    anchor: 0,
    resizeObserver: null,
    candleData: [],
    loadingEarlier: false,
    noMoreEarlier: false,
  };

  const elements = {};

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    [
      'review-dialog', 'review-video-title', 'review-video-time', 'chart-symbol', 'chart-interval',
      'future-days', 'close-review', 'review-chart', 'drawing-overlay', 'chart-loading',
      'chart-status', 'chart-cutoff', 'delete-drawing', 'clear-drawings',
    ].forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });

    elements.closeReview.addEventListener('click', close);
    elements.chartSymbol.addEventListener('change', () => {
      state.symbol = elements.chartSymbol.value;
      resetDrawingInteraction();
      void reloadScope();
    });
    elements.chartInterval.querySelectorAll('[data-chart-interval]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.interval === button.dataset.chartInterval) return;
        state.interval = button.dataset.chartInterval;
        updateIntervalButtons();
        resetDrawingInteraction();
        void reloadScope();
      });
    });
    elements.futureDays.addEventListener('change', saveFutureDays);
    document.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      button.addEventListener('click', () => setTool(state.tool === button.dataset.drawingTool ? null : button.dataset.drawingTool));
    });
    elements.deleteDrawing.addEventListener('click', deleteSelectedDrawing);
    elements.clearDrawings.addEventListener('click', clearDrawings);
    elements.drawingOverlay.addEventListener('click', handleOverlayClick);
    elements.drawingOverlay.addEventListener('pointermove', handleOverlayPointerMove);
    elements.drawingOverlay.addEventListener('pointerup', handleOverlayPointerUp);
    elements.drawingOverlay.addEventListener('pointercancel', handleOverlayPointerUp);
    elements.reviewDialog.addEventListener('close', resetDrawingInteraction);
  }

  async function open(video) {
    init();
    state.video = video;
    state.anchor = videoTimestamp(video);
    elements.reviewVideoTitle.textContent = video['视频标题'];
    elements.reviewVideoTime.textContent = `视频发布：${video['发布日期']} ${video['发布时间（页面时区）']}`;
    if (!elements.reviewDialog.open) elements.reviewDialog.showModal();
    ensureChart();
    try {
      const response = await fetch('/api/chart/config');
      const config = await readJson(response);
      state.futureDays = Number(config.futureDays ?? 3);
      elements.futureDays.value = state.futureDays;
    } catch (error) {
      setStatus('读取图表配置失败，暂用默认 3 天。', true);
    }
    await reloadScope();
  }

  function close() {
    if (document.body.dataset.reviewStandalone === 'true') {
      window.close();
      if (!window.closed) window.location.href = '/';
      return;
    }
    elements.reviewDialog.close();
  }

  function ensureChart() {
    if (state.chart) {
      resizeChart();
      return;
    }
    if (!window.LightweightCharts) {
      setStatus('图表组件未加载，请刷新页面。', true);
      return;
    }
    state.chart = window.LightweightCharts.createChart(elements.reviewChart, {
      width: elements.reviewChart.clientWidth,
      height: elements.reviewChart.clientHeight,
      layout: {
        background: { type: window.LightweightCharts.ColorType.Solid, color: '#101318' },
        textColor: '#9aa4b2',
      },
      grid: {
        vertLines: { color: '#1f2732' },
        horzLines: { color: '#1f2732' },
      },
      rightPriceScale: { borderColor: '#303844' },
      timeScale: { borderColor: '#303844', timeVisible: true, secondsVisible: false, rightOffset: 8 },
      crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal },
      localization: { locale: 'zh-CN' },
    });
    const options = {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    };
    state.series = typeof state.chart.addSeries === 'function'
      ? state.chart.addSeries(window.LightweightCharts.CandlestickSeries, options)
      : state.chart.addCandlestickSeries(options);
    state.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      renderDrawings();
      if (range && range.from < 40) void loadEarlierCandles();
    });
    state.resizeObserver = new ResizeObserver(() => {
      resizeChart();
      renderDrawings();
    });
    state.resizeObserver.observe(elements.reviewChart);
  }

  function resizeChart() {
    if (!state.chart) return;
    state.chart.applyOptions({ width: elements.reviewChart.clientWidth, height: elements.reviewChart.clientHeight });
  }

  async function reloadScope() {
    if (!state.video || !state.chart || !state.series) return;
    state.loadingEarlier = false;
    state.noMoreEarlier = false;
    state.candleData = [];
    showLoading(`正在读取 ${state.symbol} ${INTERVAL_LABELS[state.interval]} K 线…`);
    try {
      const params = new URLSearchParams({
        symbol: state.symbol,
        interval: state.interval,
        anchor: String(state.anchor),
        futureDays: String(state.futureDays),
      });
      const [candlePayload, drawingPayload] = await Promise.all([
        fetch(`/api/chart/candles?${params}`).then(readJson),
        fetch(`/api/chart/drawings?${drawingScopeParams()}`).then(readJson),
      ]);
      const candles = candlePayload.candles || [];
      state.candleData = candles.map(toChartCandle);
      renderCandleData();
      state.drawings = drawingPayload.drawings || [];
      state.selectedId = '';
      const from = Math.max(0, candles.length - 160);
      if (candles.length) state.chart.timeScale().setVisibleLogicalRange({ from, to: candles.length + 55 });
      elements.chartCutoff.textContent = `严格截止：${formatTimestamp(candlePayload.requestedCutoff)}（发布后 ${state.futureDays} 天）`;
      const cacheLabel = candlePayload.source === 'bybit' ? 'Bybit 已写入 SQLite' : '已从 SQLite 读取';
      setStatus(candlePayload.warning ? `${cacheLabel}；${candlePayload.warning}` : `${cacheLabel} · ${candles.length} 根 K 线 · 向左拖动自动加载更早数据`, Boolean(candlePayload.warning));
      renderDrawings();
    } catch (error) {
      state.series.setData([]);
      state.candleData = [];
      state.drawings = [];
      setStatus(error.message || 'K 线加载失败', true);
    } finally {
      hideLoading();
    }
  }

  async function loadEarlierCandles() {
    if (state.loadingEarlier || state.noMoreEarlier || !state.candleData.length) return;
    state.loadingEarlier = true;
    const before = Number(state.candleData[0].time) * 1000;
    const visibleRange = state.chart.timeScale().getVisibleLogicalRange();
    setStatus(`正在加载更早的 ${INTERVAL_LABELS[state.interval]} K 线…`);
    try {
      const params = new URLSearchParams({
        symbol: state.symbol,
        interval: state.interval,
        before: String(before),
        limit: '1000',
      });
      const payload = await fetch(`/api/chart/candles?${params}`).then(readJson);
      const knownTimes = new Set(state.candleData.map((candle) => Number(candle.time)));
      const earlier = (payload.candles || []).map(toChartCandle).filter((candle) => !knownTimes.has(Number(candle.time)));
      if (!earlier.length) {
        state.noMoreEarlier = true;
        setStatus(payload.warning || `已到达当前可获取的最早 K 线 · 共 ${state.candleData.length} 根`, Boolean(payload.warning));
        return;
      }
      earlier.sort((left, right) => Number(left.time) - Number(right.time));
      state.candleData = [...earlier, ...state.candleData];
      renderCandleData();
      if (visibleRange) {
        state.chart.timeScale().setVisibleLogicalRange({
          from: visibleRange.from + earlier.length,
          to: visibleRange.to + earlier.length,
        });
      }
      state.noMoreEarlier = payload.hasMore === false;
      const cacheLabel = payload.source === 'bybit' ? '更早数据已写入 SQLite' : '更早数据已从 SQLite 读取';
      const suffix = state.noMoreEarlier ? ' · 已到最早数据' : ' · 继续向左可加载更多';
      setStatus(payload.warning ? `${cacheLabel}；${payload.warning}` : `${cacheLabel} · 当前共 ${state.candleData.length} 根${suffix}`, Boolean(payload.warning));
      renderDrawings();
    } catch (error) {
      setStatus(error.message || '更早 K 线加载失败，请稍后重试', true);
    } finally {
      state.loadingEarlier = false;
    }
  }

  function toChartCandle(candle) {
    return {
      time: Math.floor(candle.timestamp / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    };
  }

  function renderCandleData() {
    state.series.setData([...state.candleData, ...rightWhitespace(state.candleData, state.interval)]);
  }

  async function saveFutureDays() {
    const next = Number(elements.futureDays.value);
    if (!Number.isInteger(next) || next < 0 || next > 30) {
      elements.futureDays.value = state.futureDays;
      setStatus('未来天数必须是 0–30 的整数。', true);
      return;
    }
    try {
      const payload = await fetch('/api/chart/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ futureDays: next }),
      }).then(readJson);
      state.futureDays = payload.futureDays;
      await reloadScope();
    } catch (error) {
      elements.futureDays.value = state.futureDays;
      setStatus(error.message || '配置保存失败', true);
    }
  }

  function setTool(tool) {
    state.tool = tool;
    state.draftPoint = null;
    state.hoverPoint = null;
    state.selectedId = '';
    elements.drawingOverlay.classList.toggle('drawing', Boolean(tool));
    document.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.drawingTool === tool);
    });
    updateDrawingButtons();
    renderDrawings();
  }

  function resetDrawingInteraction() {
    state.drag = null;
    setTool(null);
  }

  async function handleOverlayClick(event) {
    if (!state.tool || state.drag) return;
    if (state.tool === 'select') {
      state.selectedId = drawingAtClientPoint(event.clientX, event.clientY)?.id || '';
      updateDrawingButtons();
      renderDrawings();
      return;
    }
    const point = pointFromEvent(event);
    if (!point) return;
    if (state.tool === 'horizontal') {
      await createDrawing('horizontal', [point]);
      return;
    }
    if (!state.draftPoint) {
      state.draftPoint = point;
      state.hoverPoint = point;
      renderDrawings();
      return;
    }
    await createDrawing(state.tool, [state.draftPoint, point]);
  }

  function handleOverlayPointerMove(event) {
    const point = pointFromEvent(event);
    if (!point) return;
    if (state.drag) {
      const updated = moveDrawing(state.drag.original, state.drag.target, state.drag.startPoint, point);
      state.drawings = state.drawings.map((drawing) => drawing.id === updated.id ? updated : drawing);
      state.drag.current = updated;
      renderDrawings();
      return;
    }
    if (state.tool && state.tool !== 'select' && state.draftPoint) {
      state.hoverPoint = point;
      renderDrawings();
    }
  }

  async function handleOverlayPointerUp(event) {
    if (!state.drag) return;
    try { elements.drawingOverlay.releasePointerCapture(event.pointerId); } catch (_) { /* capture may already be released */ }
    const updated = state.drag.current;
    state.drag = null;
    if (updated) await persistDrawing(updated);
  }

  async function createDrawing(kind, points) {
    try {
      const saved = await persistDrawing({
        videoId: state.video['视频ID'], symbol: state.symbol, interval: state.interval, kind, points,
      });
      setTool(null);
      state.selectedId = saved.id;
      updateDrawingButtons();
      setStatus('画图已保存到 SQLite。');
    } catch (error) {
      setStatus(error.message || '画图保存失败', true);
    }
  }

  async function persistDrawing(drawing) {
    const saved = await fetch('/api/chart/drawings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(drawing),
    }).then(readJson);
    state.drawings = [...state.drawings.filter((item) => item.id !== saved.id), saved];
    renderDrawings();
    return saved;
  }

  async function deleteSelectedDrawing() {
    if (!state.selectedId) return;
    try {
      await fetch(`/api/chart/drawings?${new URLSearchParams({ id: state.selectedId })}`, { method: 'DELETE' }).then(readJson);
      state.drawings = state.drawings.filter((drawing) => drawing.id !== state.selectedId);
      state.selectedId = '';
      updateDrawingButtons();
      renderDrawings();
      setStatus('已删除选中的画图。');
    } catch (error) {
      setStatus(error.message || '删除失败', true);
    }
  }

  async function clearDrawings() {
    if (!state.drawings.length || !window.confirm('清空当前视频、合约和周期下的全部画图？')) return;
    try {
      await fetch(`/api/chart/drawings?${drawingScopeParams()}`, { method: 'DELETE' }).then(readJson);
      state.drawings = [];
      state.selectedId = '';
      updateDrawingButtons();
      renderDrawings();
      setStatus('当前范围的画图已清空。');
    } catch (error) {
      setStatus(error.message || '清空失败', true);
    }
  }

  function renderDrawings() {
    if (!state.chart || !state.series || !elements.drawingOverlay) return;
    const width = elements.drawingOverlay.clientWidth;
    const height = elements.drawingOverlay.clientHeight;
    const parts = [];
    const anchorX = state.chart.timeScale().timeToCoordinate(Math.floor(state.anchor / 1000));
    if (anchorX != null) {
      parts.push(`<line x1="${anchorX}" x2="${anchorX}" y1="0" y2="${height}" stroke="#fb7185" stroke-width="1" stroke-dasharray="5 5" opacity=".9" />`);
      parts.push(`<text x="${Math.min(anchorX + 5, Math.max(5, width - 58))}" y="58" fill="#fb7185" font-size="11">视频发布</text>`);
    }
    state.drawings.forEach((drawing) => parts.push(drawingMarkup(drawing, drawing.id === state.selectedId, width)));
    if (state.draftPoint && state.hoverPoint && state.tool) {
      parts.push(drawingMarkup({ id: 'draft', kind: state.tool, points: [state.draftPoint, state.hoverPoint] }, false, width, true));
    }
    elements.drawingOverlay.innerHTML = parts.join('');
    elements.drawingOverlay.querySelectorAll('[data-drawing-id]').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        if (node.dataset.drawingId === 'draft') return;
        state.selectedId = node.dataset.drawingId;
        updateDrawingButtons();
        renderDrawings();
      });
      node.addEventListener('pointerdown', startDrawingDrag);
    });
    updateDrawingButtons();
  }

  function drawingMarkup(drawing, selected, width, draft = false) {
    const color = draft ? '#94a3b8' : selected ? '#facc15' : '#38bdf8';
    const strokeWidth = selected ? 2.5 : 1.5;
    const id = escapeAttribute(drawing.id);
    if (drawing.kind === 'horizontal') {
      const y = state.series.priceToCoordinate(drawing.points[0]?.price);
      if (y == null) return '';
      return `<g><line x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="transparent" stroke-width="14" class="drawing-hit" data-drawing-id="${id}" data-drag-target="body" /><line x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="${strokeWidth}" class="drawing-shape" />${selected ? handleMarkup(24, y, id, 'body') : ''}</g>`;
    }
    const first = pointToScreen(drawing.points[0]);
    const second = pointToScreen(drawing.points[1]);
    if (!first || !second) return '';
    if (drawing.kind === 'fibonacci') {
      const x1 = Math.min(first.x, second.x);
      const x2 = Math.max(first.x, second.x);
      const labelX = Math.min(width - 35, x2 + 4);
      const lines = FIB_LEVELS.map((level) => {
        const y = first.y + (second.y - first.y) * level;
        return `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="transparent" stroke-width="14" class="drawing-hit" data-drawing-id="${id}" data-drag-target="body" /><line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${level === 0 || level === 1 ? 1 : .78}" class="drawing-shape" /><text x="${labelX}" y="${y - 3}" class="fibo-label">${(level * 100).toFixed(level === 0 || level === 1 ? 0 : 1)}%</text>`;
      }).join('');
      return `<g>${lines}${selected ? `${handleMarkup(first.x, first.y, id, 'start')}${handleMarkup(second.x, second.y, id, 'end')}` : ''}</g>`;
    }
    return `<g><line x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}" stroke="transparent" stroke-width="14" class="drawing-hit" data-drawing-id="${id}" data-drag-target="body" /><line x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}" stroke="${color}" stroke-width="${strokeWidth}" class="drawing-shape" />${selected ? `${handleMarkup(first.x, first.y, id, 'start')}${handleMarkup(second.x, second.y, id, 'end')}` : ''}</g>`;
  }

  function handleMarkup(x, y, id, target) {
    return `<circle cx="${x}" cy="${y}" r="5" class="drawing-handle" data-drawing-id="${id}" data-drag-target="${target}" />`;
  }

  function startDrawingDrag(event) {
    if (state.tool !== 'select') return;
    event.stopPropagation();
    const id = event.currentTarget.dataset.drawingId;
    const drawing = state.drawings.find((item) => item.id === id);
    const point = pointFromEvent(event);
    if (!drawing || !point) return;
    state.selectedId = id;
    state.drag = {
      original: JSON.parse(JSON.stringify(drawing)),
      current: drawing,
      target: event.currentTarget.dataset.dragTarget || 'body',
      startPoint: point,
    };
    elements.drawingOverlay.setPointerCapture(event.pointerId);
    updateDrawingButtons();
  }

  function moveDrawing(drawing, target, startPoint, currentPoint) {
    const priceDelta = currentPoint.price - startPoint.price;
    const timeDelta = currentPoint.time - startPoint.time;
    return {
      ...drawing,
      points: drawing.points.map((point, index) => {
        if (drawing.kind === 'horizontal') return { ...point, price: point.price + priceDelta };
        if (target === 'body') return { time: point.time + timeDelta, price: point.price + priceDelta };
        const moves = (target === 'start' && index === 0) || (target === 'end' && index === 1);
        return moves ? { time: currentPoint.time, price: currentPoint.price } : point;
      }),
    };
  }

  function pointFromEvent(event) {
    if (!state.chart || !state.series) return null;
    const rect = elements.drawingOverlay.getBoundingClientRect();
    const time = state.chart.timeScale().coordinateToTime(event.clientX - rect.left);
    const price = state.series.coordinateToPrice(event.clientY - rect.top);
    if (typeof time !== 'number' || price == null || price <= 0) return null;
    return { time, price };
  }

  function pointToScreen(point) {
    if (!point) return null;
    const x = state.chart.timeScale().timeToCoordinate(point.time);
    const y = state.series.priceToCoordinate(point.price);
    return x == null || y == null ? null : { x, y };
  }

  function drawingAtClientPoint(clientX, clientY) {
    const rect = elements.drawingOverlay.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    let nearest = null;
    let nearestDistance = 14;
    for (const drawing of state.drawings) {
      const segments = drawingSegments(drawing, rect.width);
      for (const segment of segments) {
        const distance = distanceToSegment(point, segment[0], segment[1]);
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearest = drawing;
        }
      }
    }
    return nearest;
  }

  function drawingSegments(drawing, width) {
    if (drawing.kind === 'horizontal') {
      const y = state.series.priceToCoordinate(drawing.points[0]?.price);
      return y == null ? [] : [[{ x: 0, y }, { x: width, y }]];
    }
    const first = pointToScreen(drawing.points[0]);
    const second = pointToScreen(drawing.points[1]);
    if (!first || !second) return [];
    if (drawing.kind !== 'fibonacci') return [[first, second]];
    const x1 = Math.min(first.x, second.x);
    const x2 = Math.max(first.x, second.x);
    return FIB_LEVELS.map((level) => {
      const y = first.y + (second.y - first.y) * level;
      return [{ x: x1, y }, { x: x2, y }];
    });
  }

  function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
  }

  function updateDrawingButtons() {
    elements.deleteDrawing.disabled = !state.selectedId;
    elements.clearDrawings.disabled = state.drawings.length === 0;
  }

  function updateIntervalButtons() {
    elements.chartInterval.querySelectorAll('[data-chart-interval]').forEach((button) => {
      button.classList.toggle('active', button.dataset.chartInterval === state.interval);
    });
  }

  function drawingScopeParams() {
    return new URLSearchParams({ videoId: state.video['视频ID'], symbol: state.symbol, interval: state.interval }).toString();
  }

  function rightWhitespace(candleData, interval) {
    if (!candleData.length) return [];
    const step = INTERVAL_SECONDS[interval];
    const lastTime = Number(candleData[candleData.length - 1].time);
    return Array.from({ length: RIGHT_WHITESPACE_BARS }, (_, index) => ({ time: lastTime + step * (index + 1) }));
  }

  function videoTimestamp(video) {
    const timestamp = Date.parse(`${video['发布日期']}T${video['发布时间（页面时区）'] || '00:00:00Z'}`);
    if (!Number.isFinite(timestamp)) throw new Error('视频发布时间无法解析');
    return timestamp;
  }

  async function readJson(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
    return payload;
  }

  function showLoading(message) {
    elements.chartLoading.textContent = message;
    elements.chartLoading.hidden = false;
  }

  function hideLoading() {
    elements.chartLoading.hidden = true;
  }

  function setStatus(message, error = false) {
    elements.chartStatus.textContent = message;
    elements.chartStatus.classList.toggle('error', error);
  }

  function formatTimestamp(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(timestamp));
  }

  function escapeAttribute(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function toCamel(value) {
    return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
  }

  window.TiaReviewChart = { init, open, close };
}());
