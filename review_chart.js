(function () {
  'use strict';

  const INTERVAL_LABELS = { '5': '5 分钟', '15': '15 分钟', '60': '1 小时', '240': '4 小时', D: '日线', W: '周线' };
  const USER_TOOL_TYPES = new Set([
    'TrendLine', 'HorizontalLine', 'FibRetracement', 'Ray',
    'ExtendedLine', 'Arrow', 'Rectangle', 'ParallelChannel',
  ]);
  const FIBONACCI_LEVELS = [
    { coeff: 0, color: '#787b86' },
    { coeff: 1, color: '#787b86' },
    { coeff: 0.618, color: '#089981' },
    { coeff: 0.66, color: '#16a34a' },
    { coeff: 1.68, color: '#2962ff' },
  ];
  const SYSTEM_MARKER_ID = '__system__:video-published';
  const TOOLBAR_POSITION_KEY = 'tia-review-drawing-toolbar-position-v1';
  const PRICE_SCALE_MODE_KEY = 'tia-review-price-scale-mode-v1';
  const state = {
    initialized: false,
    video: null,
    symbol: 'BTCUSDT',
    interval: '60',
    futureDays: 3,
    offlineMode: true,
    logarithmicScale: false,
    chart: null,
    series: null,
    lineTools: null,
    drawingIds: new Set(),
    selectedId: '',
    selectedLocked: false,
    activeDrawingId: '',
    activeToolType: '',
    anchor: 0,
    resizeObserver: null,
    candleData: [],
    loadingEarlier: false,
    noMoreEarlier: false,
    undoStack: [],
    redoStack: [],
    historySnapshot: '[]',
    restoringHistory: false,
    persistenceQueue: Promise.resolve(),
  };

  const elements = {};

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    [
      'review-dialog', 'review-video-title', 'review-video-time', 'chart-symbol', 'chart-interval',
      'price-scale-mode', 'future-days', 'offline-mode', 'close-review', 'review-chart', 'chart-loading',
      'chart-status', 'chart-cutoff', 'undo-drawing', 'redo-drawing',
      'lock-drawing', 'delete-drawing', 'clear-drawings', 'drawing-tools-handle',
    ].forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });
    elements.drawingTools = document.querySelector('.drawing-tools');
    elements.chartStage = document.querySelector('.chart-stage');

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
    elements.offlineMode.addEventListener('change', saveOfflineMode);
    elements.priceScaleMode.addEventListener('click', togglePriceScaleMode);
    document.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      button.addEventListener('click', () => startDrawing(button.dataset.drawingTool));
    });
    document.querySelector('[data-drawing-action="select"]').addEventListener('click', cancelActiveDrawing);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.activeDrawingId) cancelActiveDrawing();
      if (!(event.ctrlKey || event.metaKey) || isTextInput(event.target)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        void (event.shiftKey ? redoDrawing() : undoDrawing());
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        void redoDrawing();
      }
    });
    elements.undoDrawing.addEventListener('click', undoDrawing);
    elements.redoDrawing.addEventListener('click', redoDrawing);
    elements.lockDrawing.addEventListener('click', toggleSelectedDrawingLock);
    elements.deleteDrawing.addEventListener('click', deleteSelectedDrawing);
    elements.clearDrawings.addEventListener('click', clearDrawings);
    elements.reviewDialog.addEventListener('close', cancelActiveDrawing);
    initializeDraggableToolbar();
    restorePriceScaleMode();
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
      state.offlineMode = config.offlineMode !== false;
      elements.futureDays.value = state.futureDays;
      elements.offlineMode.checked = state.offlineMode;
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
        background: { type: window.LightweightCharts.ColorType.Solid, color: '#ffffff' },
        textColor: '#475569',
      },
      grid: {
        vertLines: { color: '#edf1f6' },
        horzLines: { color: '#edf1f6' },
      },
      rightPriceScale: {
        borderColor: '#d9e1ec',
        mode: state.logarithmicScale
          ? window.LightweightCharts.PriceScaleMode.Logarithmic
          : window.LightweightCharts.PriceScaleMode.Normal,
      },
      timeScale: { borderColor: '#d9e1ec', timeVisible: true, secondsVisible: false, rightOffset: 8 },
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
    initializeLineTools();
    state.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && range.from < 40) void loadEarlierCandles();
    });
    state.resizeObserver = new ResizeObserver(() => {
      resizeChart();
    });
    state.resizeObserver.observe(elements.reviewChart);
  }

  function resizeChart() {
    if (!state.chart) return;
    state.chart.applyOptions({ width: elements.reviewChart.clientWidth, height: elements.reviewChart.clientHeight });
    constrainToolbarPosition();
  }

  function togglePriceScaleMode() {
    state.logarithmicScale = !state.logarithmicScale;
    applyPriceScaleMode();
    try {
      localStorage.setItem(PRICE_SCALE_MODE_KEY, state.logarithmicScale ? 'logarithmic' : 'normal');
    } catch (_) {
      // Private browsing or storage policies may disable localStorage.
    }
  }

  function restorePriceScaleMode() {
    try {
      state.logarithmicScale = localStorage.getItem(PRICE_SCALE_MODE_KEY) === 'logarithmic';
    } catch (_) {
      state.logarithmicScale = false;
    }
    applyPriceScaleMode();
  }

  function applyPriceScaleMode() {
    const mode = state.logarithmicScale ? 'Log' : '线性';
    elements.priceScaleMode.classList.toggle('active', state.logarithmicScale);
    elements.priceScaleMode.setAttribute('aria-pressed', String(state.logarithmicScale));
    elements.priceScaleMode.title = state.logarithmicScale ? '切换为线性价格坐标' : '切换为对数价格坐标';
    if (state.chart) {
      state.chart.priceScale('right').applyOptions({
        mode: state.logarithmicScale
          ? window.LightweightCharts.PriceScaleMode.Logarithmic
          : window.LightweightCharts.PriceScaleMode.Normal,
      });
      setStatus(`价格坐标已切换为${mode}模式。`);
    }
  }

  function initializeDraggableToolbar() {
    let drag = null;
    const handle = elements.drawingToolsHandle;

    const startDragging = (event, pointerId = null) => {
      const toolbarRect = elements.drawingTools.getBoundingClientRect();
      const stageRect = elements.chartStage.getBoundingClientRect();
      drag = {
        pointerId,
        offsetX: event.clientX - toolbarRect.left,
        offsetY: event.clientY - toolbarRect.top,
        stageLeft: stageRect.left,
        stageTop: stageRect.top,
      };
      elements.drawingTools.classList.add('dragging');
      event.preventDefault();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      startDragging(event, event.pointerId);
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      positionToolbar(event.clientX - drag.stageLeft - drag.offsetX, event.clientY - drag.stageTop - drag.offsetY);
    });

    const stopDragging = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      elements.drawingTools.classList.remove('dragging');
      persistToolbarPosition();
    };
    handle.addEventListener('pointerup', stopDragging);
    handle.addEventListener('pointercancel', stopDragging);
    handle.addEventListener('mousedown', (event) => {
      if (event.button === 0 && !drag) startDragging(event);
    });
    document.addEventListener('mousemove', (event) => {
      if (!drag) return;
      positionToolbar(event.clientX - drag.stageLeft - drag.offsetX, event.clientY - drag.stageTop - drag.offsetY);
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      elements.drawingTools.classList.remove('dragging');
      persistToolbarPosition();
    });
    handle.addEventListener('keydown', (event) => {
      const movement = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
      if (!movement) return;
      event.preventDefault();
      const left = Number.parseFloat(elements.drawingTools.style.left) || elements.drawingTools.offsetLeft;
      const top = Number.parseFloat(elements.drawingTools.style.top) || elements.drawingTools.offsetTop;
      positionToolbar(left + movement[0], top + movement[1]);
      persistToolbarPosition();
    });

    requestAnimationFrame(restoreToolbarPosition);
  }

  function positionToolbar(left, top) {
    const margin = 6;
    const maxLeft = Math.max(margin, elements.chartStage.clientWidth - elements.drawingTools.offsetWidth - margin);
    const maxTop = Math.max(margin, elements.chartStage.clientHeight - elements.drawingTools.offsetHeight - margin);
    elements.drawingTools.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`;
    elements.drawingTools.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`;
  }

  function persistToolbarPosition() {
    try {
      localStorage.setItem(TOOLBAR_POSITION_KEY, JSON.stringify({
        left: Number.parseFloat(elements.drawingTools.style.left) || elements.drawingTools.offsetLeft,
        top: Number.parseFloat(elements.drawingTools.style.top) || elements.drawingTools.offsetTop,
      }));
    } catch (_) {
      // Private browsing or storage policies may disable localStorage.
    }
  }

  function restoreToolbarPosition() {
    let position = { left: 10, top: 10 };
    try {
      position = { ...position, ...JSON.parse(localStorage.getItem(TOOLBAR_POSITION_KEY) || '{}') };
    } catch (_) {
      // Ignore invalid or unavailable local state and use the default position.
    }
    positionToolbar(Number(position.left) || 10, Number(position.top) || 10);
  }

  function constrainToolbarPosition() {
    if (!elements.drawingTools) return;
    const left = Number.parseFloat(elements.drawingTools.style.left) || elements.drawingTools.offsetLeft;
    const top = Number.parseFloat(elements.drawingTools.style.top) || elements.drawingTools.offsetTop;
    positionToolbar(left, top);
  }

  function initializeLineTools() {
    const core = window.LightweightChartsLineToolsCore;
    const lines = window.LightweightChartsLineToolsLines;
    const fib = window.LightweightChartsLineToolsFibRetracement;
    const rectangle = window.LightweightChartsLineToolsRectangle;
    const channel = window.LightweightChartsLineToolsParallelChannel;
    if (!core || !lines || !fib || !rectangle || !channel) {
      throw new Error('画图插件未完整加载，请刷新页面。');
    }
    state.lineTools = core.createLineToolsPlugin(state.chart, state.series);
    lines.registerLinesPlugin(state.lineTools);
    fib.registerFibRetracementPlugin(state.lineTools);
    state.lineTools.registerLineTool('Rectangle', rectangle.LineToolRectangle);
    channel.registerParallelChannelPlugin(state.lineTools);
    state.lineTools.setMagnetThreshold(10);
    state.lineTools.subscribeLineToolsAfterEdit(handleLineToolAfterEdit);
    state.lineTools.subscribeLineToolsSingleClick(handleLineToolSelection);
  }

  async function reloadScope() {
    if (!state.video || !state.chart || !state.series || !state.lineTools) return;
    cancelActiveDrawing();
    state.lineTools.removeAllLineTools();
    state.drawingIds.clear();
    state.selectedId = '';
    state.selectedLocked = false;
    resetDrawingHistory([]);
    updateDrawingButtons();
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
      const drawings = (drawingPayload.drawings || [])
        .filter((drawing) => USER_TOOL_TYPES.has(drawing.toolType))
        .map(normalizeDrawingStyle);
      if (drawings.length && !state.lineTools.importLineTools(JSON.stringify(drawings))) {
        throw new Error('已保存的画图数据无法导入。');
      }
      state.drawingIds = new Set(drawings.map((drawing) => drawing.id));
      addVideoPublishedMarker();
      resetDrawingHistory(drawings);
      const from = Math.max(0, candles.length - 160);
      if (candles.length) state.chart.timeScale().setVisibleLogicalRange({ from, to: candles.length + 55 });
      elements.chartCutoff.textContent = `严格截止：${formatTimestamp(candlePayload.requestedCutoff)}（发布后 ${state.futureDays} 天）`;
      const cacheLabel = candlePayload.source === 'bybit' ? 'Bybit 已写入 SQLite' : '已从 SQLite 读取';
      setStatus(candlePayload.warning ? `${cacheLabel}；${candlePayload.warning}` : `${cacheLabel} · ${candles.length} 根 K 线 · 向左拖动自动加载更早数据`, Boolean(candlePayload.warning));
      updateDrawingButtons();
    } catch (error) {
      state.series.setData([]);
      state.candleData = [];
      state.lineTools.removeAllLineTools();
      state.drawingIds.clear();
      resetDrawingHistory([]);
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
    state.series.setData(state.candleData);
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

  function startDrawing(toolType) {
    if (!state.lineTools || !USER_TOOL_TYPES.has(toolType)) return;
    cancelActiveDrawing();
    state.selectedId = '';
    state.activeToolType = toolType;
    state.activeDrawingId = state.lineTools.addLineTool(toolType, [], drawingOptions(toolType));
    if (!state.activeDrawingId) {
      state.activeToolType = '';
      setStatus('无法启动该画图工具。', true);
    }
    updateDrawingButtons();
  }

  async function saveOfflineMode() {
    const next = elements.offlineMode.checked;
    try {
      const payload = await fetch('/api/chart/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offlineMode: next }),
      }).then(readJson);
      state.offlineMode = payload.offlineMode;
      elements.offlineMode.checked = state.offlineMode;
      await reloadScope();
    } catch (error) {
      elements.offlineMode.checked = state.offlineMode;
      setStatus(error.message || '仅本地模式保存失败', true);
    }
  }

  function cancelActiveDrawing() {
    if (state.activeDrawingId && state.lineTools) {
      state.lineTools.removeLineToolsById([state.activeDrawingId]);
    }
    state.activeDrawingId = '';
    state.activeToolType = '';
    updateDrawingButtons();
  }

  function resetDrawingInteraction() {
    cancelActiveDrawing();
  }

  function drawingOptions(toolType) {
    const line = { color: '#2563eb', width: 2 };
    if (toolType === 'FibRetracement') {
      return { line: { width: 2 }, levels: fibonacciLevels(), magnetThreshold: 10 };
    }
    if (toolType === 'Rectangle') {
      return { line, background: { color: 'rgba(37, 99, 235, 0.10)' }, magnetThreshold: 10 };
    }
    if (toolType === 'ParallelChannel') {
      return { line, background: { color: 'rgba(37, 99, 235, 0.08)' }, magnetThreshold: 10 };
    }
    return { line, magnetThreshold: 10 };
  }

  function fibonacciLevels() {
    return FIBONACCI_LEVELS.map((level) => ({
      ...level,
      opacity: 0,
      distanceFromCoeffEnabled: false,
      distanceFromCoeff: 0,
    }));
  }

  function normalizeDrawingStyle(drawing) {
    if (drawing.toolType !== 'FibRetracement') return drawing;
    return {
      ...drawing,
      options: {
        ...drawing.options,
        line: { ...drawing.options?.line, width: 2 },
        levels: fibonacciLevels(),
      },
    };
  }

  async function handleLineToolAfterEdit(params) {
    const drawing = params?.selectedLineTool;
    if (!drawing || drawing.id === SYSTEM_MARKER_ID || !USER_TOOL_TYPES.has(drawing.toolType)) return;
    if (drawing.id === state.activeDrawingId && params.stage === 'lineToolFinished') {
      state.activeDrawingId = '';
      state.activeToolType = '';
    }
    recordDrawingHistory(currentDrawingSnapshot());
    try {
      await queuePersistence(() => persistDrawing(drawing));
      state.drawingIds.add(drawing.id);
      setStatus('画图已保存到 SQLite。');
    } catch (error) {
      setStatus(error.message || '画图保存失败', true);
    }
    updateDrawingButtons();
  }

  function handleLineToolSelection(params) {
    const drawing = params?.selectedLineTool;
    if (!drawing || drawing.id === SYSTEM_MARKER_ID) {
      state.selectedId = '';
      state.selectedLocked = false;
    } else if (params.selectionState === 'selected' && USER_TOOL_TYPES.has(drawing.toolType)) {
      state.selectedId = drawing.id;
      state.selectedLocked = drawing.options?.editable === false;
    } else if (state.selectedId === drawing.id) {
      state.selectedId = '';
      state.selectedLocked = false;
    }
    updateDrawingButtons();
  }

  async function toggleSelectedDrawingLock() {
    const id = state.selectedId;
    if (!id || id === SYSTEM_MARKER_ID) return;
    const current = JSON.parse(state.lineTools.getLineToolByID(id) || '[]')[0];
    if (!current) return;
    const locked = current.options?.editable !== false;
    const updated = {
      ...current,
      options: { ...current.options, editable: !locked },
    };
    try {
      state.lineTools.applyLineToolOptions(updated);
      recordDrawingHistory(currentDrawingSnapshot());
      await queuePersistence(() => persistDrawing(updated));
      state.selectedId = '';
      state.selectedLocked = false;
      updateDrawingButtons();
      setStatus(locked ? '画图已锁定。' : '画图已解锁。');
    } catch (error) {
      setStatus(error.message || '锁定状态保存失败', true);
    }
  }

  async function persistDrawing(drawing) {
    return fetch('/api/chart/drawings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: state.video['视频ID'], symbol: state.symbol, interval: state.interval,
        ...drawing,
      }),
    }).then(readJson);
  }

  async function deleteSelectedDrawing() {
    const id = state.selectedId;
    if (!id || id === SYSTEM_MARKER_ID) return;
    try {
      const params = new URLSearchParams({ ...drawingScopeObject(), id });
      state.lineTools.removeLineToolsById([id]);
      state.drawingIds.delete(id);
      recordDrawingHistory(currentDrawingSnapshot());
      await queuePersistence(() => fetch(`/api/chart/drawings?${params}`, { method: 'DELETE' }).then(readJson));
      state.selectedId = '';
      state.selectedLocked = false;
      updateDrawingButtons();
      setStatus('已删除选中的画图。');
    } catch (error) {
      setStatus(error.message || '删除失败', true);
    }
  }

  async function clearDrawings() {
    if (!state.drawingIds.size || !window.confirm('清空当前视频和合约在所有周期下的全部画图？')) return;
    try {
      state.lineTools.removeLineToolsById(Array.from(state.drawingIds));
      state.drawingIds.clear();
      recordDrawingHistory('[]');
      await queuePersistence(() => fetch(`/api/chart/drawings?${drawingScopeParams()}`, { method: 'DELETE' }).then(readJson));
      state.selectedId = '';
      state.selectedLocked = false;
      updateDrawingButtons();
      setStatus('当前范围的画图已清空。');
    } catch (error) {
      setStatus(error.message || '清空失败', true);
    }
  }

  function currentDrawingSnapshot() {
    if (!state.lineTools) return '[]';
    const drawings = JSON.parse(state.lineTools.exportLineTools() || '[]')
      .filter((drawing) => drawing.id !== SYSTEM_MARKER_ID && USER_TOOL_TYPES.has(drawing.toolType))
      .map(normalizeDrawingStyle)
      .sort((left, right) => left.id.localeCompare(right.id));
    return JSON.stringify(drawings);
  }

  function resetDrawingHistory(drawings) {
    const normalized = [...drawings]
      .filter((drawing) => drawing.id !== SYSTEM_MARKER_ID && USER_TOOL_TYPES.has(drawing.toolType))
      .map(normalizeDrawingStyle)
      .sort((left, right) => left.id.localeCompare(right.id));
    state.undoStack = [];
    state.redoStack = [];
    state.historySnapshot = JSON.stringify(normalized);
    updateDrawingButtons();
  }

  function recordDrawingHistory(afterSnapshot) {
    if (state.restoringHistory || afterSnapshot === state.historySnapshot) return;
    state.undoStack.push({ before: state.historySnapshot, after: afterSnapshot });
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack = [];
    state.historySnapshot = afterSnapshot;
    updateDrawingButtons();
  }

  async function undoDrawing() {
    if (!state.undoStack.length || state.restoringHistory) return;
    const entry = state.undoStack.pop();
    state.redoStack.push(entry);
    await restoreDrawingSnapshot(entry.before, '已撤销上一步画图操作。');
  }

  async function redoDrawing() {
    if (!state.redoStack.length || state.restoringHistory) return;
    const entry = state.redoStack.pop();
    state.undoStack.push(entry);
    await restoreDrawingSnapshot(entry.after, '已重做画图操作。');
  }

  async function restoreDrawingSnapshot(snapshot, message) {
    state.restoringHistory = true;
    updateDrawingButtons();
    try {
      cancelActiveDrawing();
      const drawings = JSON.parse(snapshot);
      state.lineTools.removeLineToolsById(Array.from(state.drawingIds));
      state.drawingIds.clear();
      if (drawings.length && !state.lineTools.importLineTools(JSON.stringify(drawings))) {
        throw new Error('画图历史无法恢复。');
      }
      state.drawingIds = new Set(drawings.map((drawing) => drawing.id));
      state.selectedId = '';
      state.selectedLocked = false;
      await queuePersistence(() => replacePersistedDrawings(drawings));
      state.historySnapshot = snapshot;
      setStatus(message);
    } catch (error) {
      setStatus(error.message || '画图历史恢复失败', true);
    } finally {
      state.restoringHistory = false;
      updateDrawingButtons();
    }
  }

  function replacePersistedDrawings(drawings) {
    return fetch('/api/chart/drawings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...drawingScopeObject(), drawings }),
    }).then(readJson);
  }

  function queuePersistence(task) {
    state.persistenceQueue = state.persistenceQueue.catch(() => {}).then(task);
    return state.persistenceQueue;
  }

  function addVideoPublishedMarker() {
    const price = state.candleData.find((candle) => Number(candle.time) >= Math.floor(state.anchor / 1000))?.close
      || state.candleData[state.candleData.length - 1]?.close;
    if (!price) return;
    state.lineTools.createOrUpdateLineTool(
      'VerticalLine',
      [{ timestamp: Math.floor(state.anchor / 1000), price }],
      {
        editable: false,
        showTimeAxisLabels: true,
        timeAxisLabelAlwaysVisible: true,
        line: { color: '#fb7185', width: 1, style: window.LightweightCharts.LineStyle.Dashed },
        text: { value: '视频发布', font: { color: '#fb7185', size: 11 } },
      },
      SYSTEM_MARKER_ID,
    );
  }

  function updateDrawingButtons() {
    elements.undoDrawing.disabled = state.restoringHistory || state.undoStack.length === 0;
    elements.redoDrawing.disabled = state.restoringHistory || state.redoStack.length === 0;
    elements.lockDrawing.disabled = !state.selectedId;
    elements.lockDrawing.textContent = state.selectedLocked ? '🔓' : '🔒';
    elements.lockDrawing.title = state.selectedLocked ? '解锁选中画图' : '锁定选中画图';
    elements.lockDrawing.setAttribute('aria-label', elements.lockDrawing.title);
    elements.lockDrawing.classList.toggle('active', state.selectedLocked);
    elements.deleteDrawing.disabled = !state.selectedId;
    elements.clearDrawings.disabled = state.drawingIds.size === 0;
    document.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.drawingTool === state.activeToolType);
    });
    document.querySelector('[data-drawing-action="select"]').classList.toggle('active', !state.activeToolType);
  }

  function updateIntervalButtons() {
    elements.chartInterval.querySelectorAll('[data-chart-interval]').forEach((button) => {
      button.classList.toggle('active', button.dataset.chartInterval === state.interval);
    });
  }

  function drawingScopeParams() {
    return new URLSearchParams(drawingScopeObject()).toString();
  }

  function drawingScopeObject() {
    return { videoId: state.video['视频ID'], symbol: state.symbol, interval: state.interval };
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

  function toCamel(value) {
    return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
  }

  function isTextInput(target) {
    return target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  window.TiaReviewChart = { init, open, close };
}());
