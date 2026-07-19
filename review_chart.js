(function () {
  'use strict';

  const INTERVAL_LABELS = { '5': '5 分钟', '15': '15 分钟', '60': '1 小时', '240': '4 小时', D: '日线', W: '周线' };
  const INTERVAL_SECONDS = { '5': 300, '15': 900, '60': 3600, '240': 14400, D: 86400, W: 604800 };
  const LEGACY_TOOL_TYPES = new Set([
    'TrendLine', 'HorizontalLine', 'HorizontalRay', 'VerticalLine', 'FibRetracement',
    'Ray', 'ExtendedLine', 'Arrow', 'Rectangle', 'ParallelChannel',
  ]);
  const ENHANCED_TYPE_MAP = {
    'short-position': 'ShortPosition',
    'long-position': 'LongPosition',
    'date-price-range': 'DatePriceRange',
    path: 'Path',
    'text-annotation': 'TextAnnotation',
    'fixed-range-volume-profile': 'FixedRangeVolumeProfile',
    'arrow-mark-up': 'ArrowMarkUp',
    'arrow-mark-down': 'ArrowMarkDown',
    brush: 'Brush',
    'rotated-rectangle': 'RotatedRectangle',
  };
  const ENHANCED_TOOL_TYPES = new Set(Object.values(ENHANCED_TYPE_MAP));
  const USER_TOOL_TYPES = new Set([...LEGACY_TOOL_TYPES, ...ENHANCED_TOOL_TYPES]);
  const ENHANCED_ANCHOR_COUNTS = {
    'short-position': 3, 'long-position': 3, 'date-price-range': 2,
    path: 2, 'text-annotation': 1, 'fixed-range-volume-profile': 2,
    'arrow-mark-up': 1, 'arrow-mark-down': 1, brush: 2, 'rotated-rectangle': 3,
  };
  const FIBONACCI_LEVELS = [
    { coeff: 0, color: '#787b86' },
    { coeff: 0.618, color: '#089981' },
    { coeff: 0.66, color: '#16a34a' },
    { coeff: 1, color: '#787b86' },
  ];
  const SYSTEM_MARKER_ID = '__system__:video-published';
  const TOOLBAR_POSITION_KEY = 'tia-review-drawing-toolbar-position-v1';
  const PRICE_SCALE_MODE_KEY = 'tia-review-price-scale-mode-v1';
  const FUTURE_WHITESPACE_BARS = 500;
  const VISIBLE_RIGHT_PADDING_BARS = 4;
  const state = {
    initialized: false,
    mode: 'review',
    video: null,
    symbol: 'BTCUSDT',
    interval: '60',
    futureDays: 3,
    offlineMode: true,
    logarithmicScale: false,
    chart: null,
    series: null,
    lineTools: null,
    enhancedDrawings: null,
    enhancedPreview: null,
    enhancedPendingAnchors: [],
    enhancedBrushActive: false,
    selectedEngine: '',
    enhancedSaveTimer: null,
    drawingPersistenceEpoch: 0,
    clearingDrawings: false,
    loadingDrawings: false,
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
    replayDate: '',
    replayReady: false,
    replayStartIndex: 0,
    replayVisibleCount: 0,
    replaySpeed: 1,
    replayTimer: null,
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
      'replay-controls', 'replay-date', 'start-replay', 'toggle-replay', 'step-replay',
      'replay-speed', 'replay-progress',
      'drawing-input-layer',
    ].forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });
    elements.drawingTools = document.querySelector('.drawing-tools');
    elements.chartStage = document.querySelector('.chart-stage');

    elements.closeReview.addEventListener('click', close);
    elements.chartSymbol.addEventListener('change', () => {
      state.symbol = elements.chartSymbol.value;
      resetDrawingInteraction();
      void reloadActiveScope();
    });
    elements.chartInterval.querySelectorAll('[data-chart-interval]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.interval === button.dataset.chartInterval) return;
        state.interval = button.dataset.chartInterval;
        updateIntervalButtons();
        resetDrawingInteraction();
        void reloadActiveScope();
      });
    });
    elements.futureDays.addEventListener('change', saveFutureDays);
    elements.offlineMode.addEventListener('change', saveOfflineMode);
    elements.priceScaleMode.addEventListener('click', togglePriceScaleMode);
    elements.replayDate.addEventListener('change', resetReplaySelection);
    elements.startReplay.addEventListener('click', startReplayFromSelection);
    elements.toggleReplay.addEventListener('click', toggleReplayPlayback);
    elements.stepReplay.addEventListener('click', () => stepReplay(true));
    elements.replaySpeed.addEventListener('change', changeReplaySpeed);
    document.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      button.addEventListener('click', () => startDrawing(button.dataset.drawingTool));
    });
    document.querySelectorAll('[data-enhanced-tool]').forEach((button) => {
      button.addEventListener('click', () => startEnhancedDrawing(button.dataset.enhancedTool));
    });
    document.querySelector('[data-drawing-action="select"]').addEventListener('click', cancelActiveDrawing);
    initializeEnhancedDrawingInput();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' && state.mode === 'replay' && state.replayReady && !isTextInput(event.target)) {
        event.preventDefault();
        stepReplay(true);
        return;
      }
      if (event.key === 'Escape' && (state.activeDrawingId || state.activeToolType)) cancelActiveDrawing();
      if (event.key === 'Enter' && state.activeToolType === 'path' && state.enhancedPendingAnchors.length >= 2) {
        event.preventDefault();
        void finishEnhancedDrawing();
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId && !isTextInput(event.target)) {
        event.preventDefault();
        void deleteSelectedDrawing();
      }
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
    stopReplayPlayback();
    state.mode = 'review';
    state.replayReady = false;
    elements.replayControls.hidden = true;
    state.video = video;
    state.anchor = videoTimestamp(video);
    elements.reviewVideoTitle.textContent = video['视频标题'];
    elements.reviewVideoTime.textContent = `视频发布：${video['发布日期']} ${video['发布时间（页面时区）']}`;
    if (!elements.reviewDialog.open) elements.reviewDialog.showModal();
    ensureChart();
    await loadChartConfig();
    await reloadScope();
  }

  async function openReplay() {
    init();
    stopReplayPlayback();
    state.mode = 'replay';
    state.video = null;
    state.anchor = 0;
    state.replayDate = '';
    state.replayReady = false;
    state.replaySpeed = 1;
    elements.replayControls.hidden = false;
    elements.replayDate.max = beijingDateString(new Date());
    elements.replayDate.value = elements.replayDate.max;
    elements.replaySpeed.value = '1';
    elements.reviewVideoTitle.textContent = 'BTC / ETH 行情复盘';
    elements.reviewVideoTime.textContent = '选择日期后，从北京时间 00:00 开始逐根回放';
    if (!elements.reviewDialog.open) elements.reviewDialog.showModal();
    ensureChart();
    await loadChartConfig();
    resetReplaySelection();
  }

  async function loadChartConfig() {
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
  }

  function close() {
    stopReplayPlayback();
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
    initializeEnhancedDrawingManager();
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

  function initializeEnhancedDrawingManager() {
    const drawing = window.LightweightChartsDrawing;
    if (!drawing?.DrawingManager || !drawing?.getToolRegistry) {
      throw new Error('增强画图组件未加载，请刷新页面。');
    }
    state.enhancedDrawings = new drawing.DrawingManager();
    state.enhancedDrawings.attach(state.chart, state.series, elements.reviewChart);
    state.enhancedDrawings.on('drawing:selected', ({ drawing: selected }) => {
      if (!selected || selected.id === '__enhanced-preview') return;
      state.lineTools?.deselectAllTools?.();
      state.selectedId = selected.id;
      state.selectedEngine = 'enhanced';
      state.selectedLocked = selected.options?.locked === true;
      updateDrawingButtons();
    });
    state.enhancedDrawings.on('drawing:deselected', ({ drawingId }) => {
      if (state.selectedEngine === 'enhanced' && state.selectedId === drawingId) {
        state.selectedId = '';
        state.selectedEngine = '';
        state.selectedLocked = false;
        updateDrawingButtons();
      }
    });
    state.enhancedDrawings.on('drawing:updated', ({ drawing: updated }) => {
      if (!updated || updated.id === '__enhanced-preview') return;
      window.clearTimeout(state.enhancedSaveTimer);
      const persistenceEpoch = state.drawingPersistenceEpoch;
      const scope = drawingScopeObject();
      state.enhancedSaveTimer = window.setTimeout(() => {
        state.enhancedSaveTimer = null;
        if (persistenceEpoch !== state.drawingPersistenceEpoch) return;
        recordDrawingHistory(currentDrawingSnapshot());
        void queuePersistence(() => persistEnhancedDrawing(updated, scope))
          .then(() => setStatus('画图已保存到 SQLite。'))
          .catch((error) => setStatus(error.message || '画图保存失败', true));
      }, 220);
    });
  }

  async function reloadScope() {
    if (!state.video || !state.chart || !state.series || !state.lineTools) return;
    invalidatePendingDrawingSaves();
    cancelActiveDrawing();
    state.lineTools.removeAllLineTools();
    state.enhancedDrawings?.clearAll();
    state.drawingIds.clear();
    state.selectedId = '';
    state.selectedLocked = false;
    resetDrawingHistory([]);
    updateDrawingButtons();
    state.loadingEarlier = false;
    state.noMoreEarlier = false;
    state.candleData = [];
    state.loadingDrawings = true;
    showLoading(`正在读取 ${state.symbol} ${INTERVAL_LABELS[state.interval]} K 线…`);
    let drawingsLoaded = false;
    try {
      const params = new URLSearchParams({
        symbol: state.symbol,
        interval: state.interval,
        anchor: String(state.anchor),
        futureDays: String(state.futureDays),
      });
      const [candleResult, drawingResult] = await Promise.allSettled([
        fetch(`/api/chart/candles?${params}`).then(readJson),
        fetch(`/api/chart/drawings?${drawingScopeParams()}`).then(readJson),
      ]);
      if (drawingResult.status === 'rejected') throw drawingResult.reason;
      const drawingPayload = drawingResult.value;
      const drawings = (drawingPayload.drawings || []).filter((drawing) => USER_TOOL_TYPES.has(drawing.toolType));
      state.drawingIds = new Set(drawings.map((drawing) => drawing.id));
      resetDrawingHistory(drawings);
      drawingsLoaded = true;
      updateDrawingButtons();
      if (candleResult.status === 'rejected') throw candleResult.reason;
      const candlePayload = candleResult.value;
      const candles = candlePayload.candles || [];
      state.candleData = candles.map(toChartCandle);
      if (state.mode === 'replay') {
        const anchorSeconds = Math.floor(state.anchor / 1000);
        const firstFutureIndex = state.candleData.findIndex((candle) => Number(candle.time) + INTERVAL_SECONDS[state.interval] > anchorSeconds);
        state.replayVisibleCount = firstFutureIndex < 0 ? state.candleData.length : firstFutureIndex;
        state.replayStartIndex = state.replayVisibleCount;
        state.replayReady = state.replayVisibleCount > 0;
      }
      renderCandleData();
      const legacyDrawings = drawings.filter((drawing) => LEGACY_TOOL_TYPES.has(drawing.toolType)).map(normalizeDrawingStyle);
      const enhancedDrawings = drawings.filter((drawing) => ENHANCED_TOOL_TYPES.has(drawing.toolType));
      if (legacyDrawings.length && !state.lineTools.importLineTools(JSON.stringify(legacyDrawings))) {
        throw new Error('已保存的画图数据无法导入。');
      }
      enhancedDrawings.forEach(importEnhancedDrawing);
      addVideoPublishedMarker();
      renderCandleData();
      const visibleCount = state.mode === 'replay' ? state.replayVisibleCount : candles.length;
      const from = Math.max(0, visibleCount - 160);
      if (visibleCount) {
        state.chart.timeScale().setVisibleLogicalRange({
          from,
          to: visibleCount + VISIBLE_RIGHT_PADDING_BARS,
        });
      }
      const cacheLabel = candlePayload.source === 'bybit' ? 'Bybit 已写入 SQLite' : '已从 SQLite 读取';
      if (state.mode === 'replay') {
        elements.chartCutoff.textContent = `回放起点：${formatTimestamp(state.anchor)} · 可播放至 ${formatTimestamp(candlePayload.requestedCutoff)}`;
        const hiddenCount = Math.max(0, state.candleData.length - state.replayStartIndex);
        setStatus(candlePayload.warning ? `${cacheLabel}；${candlePayload.warning}` : `准备完成 · 已隐藏后续 ${hiddenCount} 根 K 线`, Boolean(candlePayload.warning));
        updateReplayControls();
      } else {
        elements.chartCutoff.textContent = `严格截止：${formatTimestamp(candlePayload.requestedCutoff)}（发布后 ${state.futureDays} 天）`;
        setStatus(candlePayload.warning ? `${cacheLabel}；${candlePayload.warning}` : `${cacheLabel} · ${candles.length} 根 K 线 · 向左拖动自动加载更早数据`, Boolean(candlePayload.warning));
      }
      updateDrawingButtons();
    } catch (error) {
      state.series.setData([]);
      state.candleData = [];
      state.replayReady = false;
      state.lineTools.removeAllLineTools();
      state.enhancedDrawings?.clearAll();
      if (!drawingsLoaded) {
        state.drawingIds.clear();
        resetDrawingHistory([]);
      }
      updateReplayControls();
      const suffix = drawingsLoaded && state.drawingIds.size
        ? `；已读取 ${state.drawingIds.size} 条画图记录，仍可使用“清空”`
        : '';
      setStatus(`${error.message || 'K 线加载失败'}${suffix}`, true);
    } finally {
      state.loadingDrawings = false;
      updateDrawingButtons();
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
      if (state.mode === 'replay' && state.replayReady) {
        state.replayStartIndex += earlier.length;
        state.replayVisibleCount += earlier.length;
      }
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
      volume: Number(candle.volume) || 0,
    };
  }

  function renderCandleData() {
    const candles = state.mode === 'replay'
      ? state.candleData.slice(0, state.replayVisibleCount)
      : state.candleData;
    const chartEntries = new Map(candles.map((candle) => [Number(candle.time), candle]));
    const addWhitespace = (time) => {
      const normalized = Number(time);
      if (Number.isFinite(normalized) && normalized > 0 && !chartEntries.has(normalized)) {
        chartEntries.set(normalized, { time: normalized });
      }
    };
    if (state.mode === 'replay') {
      state.candleData.slice(state.replayVisibleCount).forEach((candle) => {
        addWhitespace(candle.time);
      });
    }
    drawingAnchorTimes().forEach(addWhitespace);
    const lastKnown = Number(state.candleData[state.candleData.length - 1]?.time || candles[candles.length - 1]?.time || 0);
    for (let index = 1; lastKnown && index <= FUTURE_WHITESPACE_BARS; index += 1) {
      addWhitespace(lastKnown + INTERVAL_SECONDS[state.interval] * index);
    }
    state.series.setData([...chartEntries.values()].sort((left, right) => Number(left.time) - Number(right.time)));
    refreshVolumeProfiles();
  }

  function drawingAnchorTimes() {
    const times = [];
    const firstCandleTime = Number(state.candleData[0]?.time || 0);
    const lastCandleTime = Number(state.candleData[state.candleData.length - 1]?.time || 0);
    const addUserAnchor = (time) => {
      const normalized = Number(time);
      if (!Number.isFinite(normalized) || normalized <= 0) return;
      // Anchors inside the loaded market range must not become standalone whitespace
      // entries. On higher timeframes an intraday anchor would otherwise insert an
      // extra logical bar and create a visible gap between consecutive daily candles.
      if (firstCandleTime && lastCandleTime && normalized >= firstCandleTime && normalized <= lastCandleTime) return;
      times.push(normalized);
    };
    state.enhancedDrawings?.getAllDrawings().forEach((drawing) => {
      if (drawing.id === '__enhanced-preview') return;
      drawing.anchors?.forEach((anchor) => addUserAnchor(anchor.time));
    });
    if (state.lineTools) {
      try {
        JSON.parse(state.lineTools.exportLineTools() || '[]').forEach((drawing) => {
          drawing.points?.forEach((point) => {
            const timestamp = Number(point.timestamp);
            if (drawing.id === SYSTEM_MARKER_ID) times.push(timestamp);
            else addUserAnchor(timestamp);
          });
        });
      } catch (_) {
        // An incomplete drawing should not prevent the chart from rendering.
      }
    }
    return times;
  }

  async function reloadActiveScope() {
    stopReplayPlayback();
    if (state.mode === 'replay') {
      if (state.replayDate) await beginReplay(state.replayDate);
      else resetReplaySelection();
      return;
    }
    await reloadScope();
  }

  function resetReplaySelection() {
    if (state.mode !== 'replay') return;
    invalidatePendingDrawingSaves();
    stopReplayPlayback();
    state.replayDate = '';
    state.replayReady = false;
    state.replayStartIndex = 0;
    state.replayVisibleCount = 0;
    state.candleData = [];
    state.video = null;
    state.anchor = 0;
    if (state.series) state.series.setData([]);
    if (state.lineTools) state.lineTools.removeAllLineTools();
    state.enhancedDrawings?.clearAll();
    state.drawingIds.clear();
    elements.startReplay.textContent = '开始复盘';
    elements.chartCutoff.textContent = '';
    setStatus('请选择日期，然后点击“开始复盘”。');
    updateReplayControls();
  }

  async function startReplayFromSelection() {
    const date = elements.replayDate.value;
    if (!date) {
      setStatus('请先选择复盘日期。', true);
      return;
    }
    await beginReplay(date);
  }

  async function beginReplay(date) {
    stopReplayPlayback();
    state.replayDate = date;
    state.replayReady = false;
    state.replayStartIndex = 0;
    state.replayVisibleCount = 0;
    state.anchor = Date.parse(`${date}T00:00:00+08:00`);
    if (!Number.isFinite(state.anchor)) {
      setStatus('复盘日期无效。', true);
      return;
    }
    state.video = {
      '视频ID': `replay-${date}`,
      '视频标题': `${date} 行情复盘`,
      '发布日期': date,
      '发布时间（页面时区）': '00:00:00+08:00',
    };
    elements.reviewVideoTitle.textContent = `${date} 行情复盘`;
    elements.reviewVideoTime.textContent = '北京时间 00:00 起 · 未来行情逐根揭示';
    elements.startReplay.textContent = '重新开始';
    updateReplayControls();
    await reloadScope();
  }

  function toggleReplayPlayback() {
    if (!state.replayReady) return;
    if (state.replayTimer) {
      stopReplayPlayback();
      setStatus('回放已暂停。');
      return;
    }
    if (state.replayVisibleCount >= state.candleData.length) {
      setStatus('回放已经完成，可点击“重新开始”。');
      return;
    }
    state.replayTimer = window.setInterval(() => stepReplay(false), 1000 / state.replaySpeed);
    updateReplayControls();
    setStatus(`正在以 ${state.replaySpeed}× 速度回放…`);
  }

  function stopReplayPlayback() {
    if (state.replayTimer) window.clearInterval(state.replayTimer);
    state.replayTimer = null;
    updateReplayControls();
  }

  function stepReplay(pauseFirst) {
    if (!state.replayReady) return;
    if (pauseFirst) stopReplayPlayback();
    if (state.replayVisibleCount >= state.candleData.length) {
      stopReplayPlayback();
      setStatus('回放完成，已到达当前范围的最后一根 K 线。');
      updateReplayControls();
      return;
    }
    const visibleRange = state.chart.timeScale().getVisibleLogicalRange();
    const candleLogicalIndex = state.replayVisibleCount;
    const candle = state.candleData[state.replayVisibleCount];
    state.replayVisibleCount += 1;
    // Hidden replay candles already exist as whitespace entries. Replacing just the
    // revealed entry avoids setData(), which resets the user's viewport on every step.
    state.series.update(candle, true);
    refreshVolumeProfiles();
    followReplayCandle(visibleRange, candleLogicalIndex);
    updateReplayControls();
    if (state.replayVisibleCount >= state.candleData.length) {
      stopReplayPlayback();
      setStatus('回放完成，已到达当前范围的最后一根 K 线。');
    } else if (pauseFirst) {
      setStatus('已前进一根 K 线。');
    }
  }

  function followReplayCandle(visibleRange, candleLogicalIndex) {
    if (!visibleRange) return;
    const span = visibleRange.to - visibleRange.from;
    if (!Number.isFinite(span) || span <= 0) return;

    // Do not snap back when the user has deliberately panned away from the replay head.
    const replayHeadWasVisible = candleLogicalIndex >= visibleRange.from - 1
      && candleLogicalIndex <= visibleRange.to + 1;
    if (!replayHeadWasVisible) return;

    const rightPadding = VISIBLE_RIGHT_PADDING_BARS;
    const desiredRightEdge = candleLogicalIndex + rightPadding;
    if (desiredRightEdge <= visibleRange.to) return;
    const shift = desiredRightEdge - visibleRange.to;
    state.chart.timeScale().setVisibleLogicalRange({
      from: visibleRange.from + shift,
      to: visibleRange.to + shift,
    });
  }

  function changeReplaySpeed() {
    const wasPlaying = Boolean(state.replayTimer);
    stopReplayPlayback();
    state.replaySpeed = Number(elements.replaySpeed.value) || 1;
    if (wasPlaying) toggleReplayPlayback();
    else updateReplayControls();
  }

  function updateReplayControls() {
    if (!elements.toggleReplay) return;
    const remaining = Math.max(0, state.candleData.length - state.replayVisibleCount);
    const played = Math.max(0, state.replayVisibleCount - state.replayStartIndex);
    const total = Math.max(0, state.candleData.length - state.replayStartIndex);
    elements.toggleReplay.disabled = !state.replayReady || remaining === 0;
    elements.stepReplay.disabled = !state.replayReady || remaining === 0;
    elements.toggleReplay.textContent = state.replayTimer ? '❚❚ 暂停' : '▶ 播放';
    if (!state.replayReady) {
      elements.replayProgress.textContent = '请选择日期';
      return;
    }
    const lastVisible = state.candleData[state.replayVisibleCount - 1];
    const currentTime = lastVisible
      ? formatTimestamp((Number(lastVisible.time) + INTERVAL_SECONDS[state.interval]) * 1000)
      : formatTimestamp(state.anchor);
    elements.replayProgress.textContent = `${currentTime} · ${played} / ${total} 根`;
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
      await reloadActiveScope();
    } catch (error) {
      elements.futureDays.value = state.futureDays;
      setStatus(error.message || '配置保存失败', true);
    }
  }

  function initializeEnhancedDrawingInput() {
    const layer = elements.drawingInputLayer;
    layer.addEventListener('click', (event) => {
      if (!state.activeToolType || state.activeToolType === 'brush') return;
      const anchor = eventToAnchor(event);
      if (!anchor) return;
      const previous = state.enhancedPendingAnchors[state.enhancedPendingAnchors.length - 1];
      if (!previous || Number(previous.time) !== Number(anchor.time) || Math.abs(previous.price - anchor.price) > Number.EPSILON) {
        state.enhancedPendingAnchors.push(anchor);
      }
      if (state.activeToolType === 'path') {
        setStatus(`路径已放置 ${state.enhancedPendingAnchors.length} 个点；双击或按 Enter 完成。`);
        updateEnhancedPreview(anchor);
        return;
      }
      const required = ENHANCED_ANCHOR_COUNTS[state.activeToolType] || 2;
      if (state.enhancedPendingAnchors.length >= required) void finishEnhancedDrawing();
      else {
        setStatus(`正在绘制：${state.enhancedPendingAnchors.length} / ${required} 个点。`);
        updateEnhancedPreview(anchor);
      }
    });
    layer.addEventListener('dblclick', (event) => {
      if (state.activeToolType !== 'path' || state.enhancedPendingAnchors.length < 2) return;
      event.preventDefault();
      void finishEnhancedDrawing();
    });
    layer.addEventListener('pointermove', (event) => {
      if (state.activeToolType === 'brush' && state.enhancedBrushActive) {
        const point = eventToAnchor(event);
        if (!point) return;
        const last = state.enhancedPendingAnchors[state.enhancedPendingAnchors.length - 1];
        const lastPixel = last ? anchorToPixel(last) : null;
        const nextPixel = anchorToPixel(point);
        if (!lastPixel || !nextPixel || Math.hypot(nextPixel.x - lastPixel.x, nextPixel.y - lastPixel.y) >= 3) {
          state.enhancedPendingAnchors.push(point);
          updateEnhancedPreview(point);
        }
        return;
      }
      if (!state.enhancedPendingAnchors.length || !state.activeToolType) return;
      const anchor = eventToAnchor(event);
      if (anchor) updateEnhancedPreview(anchor);
    });
    layer.addEventListener('pointerdown', (event) => {
      if (state.activeToolType !== 'brush' || event.button !== 0) return;
      const anchor = eventToAnchor(event);
      if (!anchor) return;
      state.enhancedBrushActive = true;
      state.enhancedPendingAnchors = [anchor];
      layer.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    const finishBrush = (event) => {
      if (!state.enhancedBrushActive) return;
      state.enhancedBrushActive = false;
      if (layer.hasPointerCapture?.(event.pointerId)) layer.releasePointerCapture(event.pointerId);
      if (state.enhancedPendingAnchors.length >= 2) void finishEnhancedDrawing();
      else cancelActiveDrawing();
    };
    layer.addEventListener('pointerup', finishBrush);
    layer.addEventListener('pointercancel', finishBrush);
  }

  function eventToAnchor(event) {
    const rect = elements.drawingInputLayer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const time = state.chart?.timeScale().coordinateToTime(x);
    const price = state.series?.coordinateToPrice(y);
    return time === null || time === undefined || price === null || price === undefined ? null : { time, price };
  }

  function anchorToPixel(anchor) {
    const x = state.chart?.timeScale().timeToCoordinate(anchor.time);
    const y = state.series?.priceToCoordinate(anchor.price);
    return x === null || x === undefined || y === null || y === undefined ? null : { x, y };
  }

  function startEnhancedDrawing(toolType) {
    if (!state.enhancedDrawings || !Object.hasOwn(ENHANCED_TYPE_MAP, toolType)) return;
    cancelActiveDrawing();
    state.lineTools?.deselectAllTools?.();
    state.enhancedDrawings.deselectAll();
    state.selectedId = '';
    state.selectedEngine = '';
    state.activeToolType = toolType;
    state.enhancedPendingAnchors = [];
    state.enhancedDrawings.setActiveTool(toolType);
    elements.drawingInputLayer.hidden = false;
    elements.drawingInputLayer.style.cursor = toolType === 'brush' ? 'crosshair' : 'crosshair';
    setStatus(toolType === 'brush' ? '按住鼠标自由绘制。' : '请在图表上放置第一个点。');
    updateDrawingButtons();
  }

  function updateEnhancedPreview(mouseAnchor) {
    removeEnhancedPreview();
    const toolType = state.activeToolType;
    if (!Object.hasOwn(ENHANCED_TYPE_MAP, toolType)) return;
    const anchors = [...state.enhancedPendingAnchors];
    if (toolType !== 'brush') anchors.push(mouseAnchor);
    const required = toolType === 'path' || toolType === 'brush' ? 2 : ENHANCED_ANCHOR_COUNTS[toolType];
    while (anchors.length < required) anchors.push({ ...mouseAnchor });
    const preview = createEnhancedDrawing(toolType, '__enhanced-preview', anchors, true);
    if (!preview) return;
    state.enhancedPreview = preview;
    state.enhancedDrawings.addDrawing(preview);
  }

  function removeEnhancedPreview() {
    if (!state.enhancedPreview) return;
    state.enhancedDrawings?.removeDrawing(state.enhancedPreview.id);
    state.enhancedPreview = null;
  }

  async function finishEnhancedDrawing() {
    const toolType = state.activeToolType;
    const anchors = [...state.enhancedPendingAnchors];
    const required = ENHANCED_ANCHOR_COUNTS[toolType] || 2;
    if (anchors.length < required) return;
    removeEnhancedPreview();
    let text = '';
    if (toolType === 'text-annotation') {
      text = window.prompt('请输入图表文字：', '')?.trim() || '';
      if (!text) {
        cancelActiveDrawing();
        setStatus('已取消文字标注。');
        return;
      }
    }
    const id = `drawing-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    const drawing = createEnhancedDrawing(toolType, id, anchors, false, text);
    if (!drawing) {
      cancelActiveDrawing();
      setStatus('无法创建该画图工具。', true);
      return;
    }
    state.enhancedDrawings.addDrawing(drawing);
    state.enhancedDrawings.selectDrawing(id);
    state.drawingIds.add(id);
    state.activeToolType = '';
    state.enhancedPendingAnchors = [];
    state.enhancedDrawings.setActiveTool(null);
    elements.drawingInputLayer.hidden = true;
    recordDrawingHistory(currentDrawingSnapshot());
    updateDrawingButtons();
    try {
      const scope = drawingScopeObject();
      await queuePersistence(() => persistEnhancedDrawing(drawing, scope));
      setStatus('画图已保存到 SQLite。');
    } catch (error) {
      setStatus(error.message || '画图保存失败', true);
    }
  }

  function enhancedStyle(toolType, preview = false) {
    const colors = {
      'short-position': '#ef5350', 'long-position': '#089981', 'date-price-range': '#2962ff',
      path: '#172033', 'text-annotation': '#172033', 'fixed-range-volume-profile': '#7c3aed',
      'arrow-mark-up': '#089981', 'arrow-mark-down': '#ef5350', brush: '#172033',
      'rotated-rectangle': '#2962ff',
    };
    const color = colors[toolType] || '#2962ff';
    return {
      lineColor: color,
      lineWidth: toolType === 'brush' ? 3 : 2,
      fillColor: preview ? `${color}18` : `${color}26`,
      fillOpacity: preview ? 0.08 : 0.15,
      showLabels: true,
      labelColor: color,
    };
  }

  function enhancedOptions(toolType, text = '') {
    if (toolType === 'text-annotation') return { text, fontSize: 15, backgroundColor: 'rgba(255,255,255,.88)', padding: 5 };
    if (toolType === 'date-price-range') return { showPrices: true, showPercentage: true, showBars: true, showDays: true, filled: true };
    if (toolType === 'rotated-rectangle') return { filled: true, showDimensions: false };
    if (toolType === 'path') return { closed: false, filled: false };
    if (toolType === 'brush') return { brushSize: 3, smoothing: 0.35 };
    if (toolType === 'fixed-range-volume-profile') return { rows: 32, valueAreaPercent: 70 };
    return {};
  }

  function createEnhancedDrawing(toolType, id, anchors, preview = false, text = '', stored = null) {
    const style = stored?.style || enhancedStyle(toolType, preview);
    const options = stored?.options || enhancedOptions(toolType, text);
    if (toolType === 'fixed-range-volume-profile') {
      const Profile = fixedRangeVolumeProfileClass();
      return new Profile(id, anchors, style, options);
    }
    return window.LightweightChartsDrawing.getToolRegistry().createDrawing(toolType, id, anchors, style, options);
  }

  let FixedRangeVolumeProfileClass = null;
  function fixedRangeVolumeProfileClass() {
    if (FixedRangeVolumeProfileClass) return FixedRangeVolumeProfileClass;
    const BaseDrawing = window.LightweightChartsDrawing.Drawing;
    FixedRangeVolumeProfileClass = class FixedRangeVolumeProfile extends BaseDrawing {
      constructor(id, anchors = [], style = {}, options = {}) {
        super(id, anchors, style, options);
        this.type = 'fixed-range-volume-profile';
      }
      isValid() { return this.anchors.length >= 2; }
      paneViews() {
        const drawing = this;
        return [{
          zOrder: () => 'normal',
          renderer: () => ({
            draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => {
              drawFixedRangeVolumeProfile(drawing, context, mediaSize);
            }),
          }),
        }];
      }
      testHit(point, viewport) {
        if (!this.isValid()) return false;
        const first = this.anchorToPixel(this.anchors[0], viewport);
        const second = this.anchorToPixel(this.anchors[1], viewport);
        if (!first || !second) return false;
        const left = Math.min(first.x, second.x) - 6;
        const right = Math.max(first.x, second.x) + 6;
        const top = Math.min(first.y, second.y) - 6;
        const bottom = Math.max(first.y, second.y) + 6;
        return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
      }
      clone(newId) { return new FixedRangeVolumeProfileClass(newId, this.anchors, this.style, this.options); }
    };
    return FixedRangeVolumeProfileClass;
  }

  function drawFixedRangeVolumeProfile(drawing, context, mediaSize) {
    if (!drawing.isValid()) return;
    const [first, second] = drawing.anchors;
    const start = Math.min(Number(first.time), Number(second.time));
    const end = Math.max(Number(first.time), Number(second.time));
    const candles = visibleCandlesForDrawings().filter((candle) => Number(candle.time) >= start && Number(candle.time) <= end);
    if (!candles.length) return;
    const low = Math.min(...candles.map((candle) => candle.low));
    const high = Math.max(...candles.map((candle) => candle.high));
    if (!(high > low)) return;
    const rows = Math.max(8, Math.min(80, Number(drawing.options.rows) || 32));
    const step = (high - low) / rows;
    const volumes = Array(rows).fill(0);
    candles.forEach((candle) => {
      const from = Math.max(0, Math.min(rows - 1, Math.floor((candle.low - low) / step)));
      const to = Math.max(from, Math.min(rows - 1, Math.floor((candle.high - low) / step)));
      const share = (Number(candle.volume) || 1) / (to - from + 1);
      for (let row = from; row <= to; row += 1) volumes[row] += share;
    });
    const maxVolume = Math.max(...volumes) || 1;
    const poc = volumes.indexOf(maxVolume);
    const x1 = state.chart.timeScale().timeToCoordinate(first.time);
    const x2 = state.chart.timeScale().timeToCoordinate(second.time);
    if (x1 === null || x2 === null) return;
    const left = Math.max(0, Math.min(x1, x2));
    const right = Math.min(mediaSize.width, Math.max(x1, x2));
    const maxWidth = Math.max(18, (right - left) * 0.72);
    context.save();
    for (let row = 0; row < rows; row += 1) {
      const yTop = state.series.priceToCoordinate(low + step * (row + 1));
      const yBottom = state.series.priceToCoordinate(low + step * row);
      if (yTop === null || yBottom === null) continue;
      const width = maxWidth * (volumes[row] / maxVolume);
      context.fillStyle = row === poc ? 'rgba(245, 158, 11, .72)' : 'rgba(124, 58, 237, .34)';
      context.fillRect(right - width, Math.min(yTop, yBottom), width, Math.max(1, Math.abs(yBottom - yTop) - 1));
    }
    context.strokeStyle = drawing.style.lineColor || '#7c3aed';
    context.lineWidth = drawing.state === 'selected' || drawing.state === 'editing' ? 2 : 1;
    const top = state.series.priceToCoordinate(high);
    const bottom = state.series.priceToCoordinate(low);
    if (top !== null && bottom !== null) context.strokeRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    context.restore();
  }

  function visibleCandlesForDrawings() {
    return state.mode === 'replay' ? state.candleData.slice(0, state.replayVisibleCount) : state.candleData;
  }

  function refreshVolumeProfiles() {
    state.enhancedDrawings?.getAllDrawings().forEach((drawing) => {
      if (drawing.type === 'fixed-range-volume-profile') drawing.requestUpdate();
    });
  }

  function startDrawing(toolType) {
    if (!state.lineTools || !LEGACY_TOOL_TYPES.has(toolType)) return;
    cancelActiveDrawing();
    state.enhancedDrawings?.deselectAll();
    state.enhancedDrawings?.setActiveTool('legacy-tool-active');
    state.selectedId = '';
    state.selectedEngine = '';
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
      await reloadActiveScope();
    } catch (error) {
      elements.offlineMode.checked = state.offlineMode;
      setStatus(error.message || '仅本地模式保存失败', true);
    }
  }

  function cancelActiveDrawing() {
    if (state.activeDrawingId && state.lineTools) {
      state.lineTools.removeLineToolsById([state.activeDrawingId]);
    }
    removeEnhancedPreview();
    state.activeDrawingId = '';
    state.activeToolType = '';
    state.enhancedPendingAnchors = [];
    state.enhancedBrushActive = false;
    state.enhancedDrawings?.setActiveTool(null);
    if (elements.drawingInputLayer) elements.drawingInputLayer.hidden = true;
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
      state.enhancedDrawings?.setActiveTool(null);
    }
    recordDrawingHistory(currentDrawingSnapshot());
    try {
      const scope = drawingScopeObject();
      await queuePersistence(() => persistDrawing(drawing, scope));
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
      state.selectedEngine = '';
      state.selectedLocked = false;
    } else if (params.selectionState === 'selected' && USER_TOOL_TYPES.has(drawing.toolType)) {
      state.enhancedDrawings?.deselectAll();
      state.selectedId = drawing.id;
      state.selectedEngine = 'legacy';
      state.selectedLocked = drawing.options?.editable === false;
    } else if (state.selectedId === drawing.id) {
      state.selectedId = '';
      state.selectedEngine = '';
      state.selectedLocked = false;
    }
    updateDrawingButtons();
  }

  async function toggleSelectedDrawingLock() {
    const id = state.selectedId;
    if (!id || id === SYSTEM_MARKER_ID) return;
    if (state.selectedEngine === 'enhanced') {
      const drawing = state.enhancedDrawings.getDrawing(id);
      if (!drawing) return;
      const locked = drawing.options?.locked === true;
      drawing.updateOptions({ locked: !locked });
      state.selectedLocked = !locked;
      recordDrawingHistory(currentDrawingSnapshot());
      updateDrawingButtons();
      try {
        const scope = drawingScopeObject();
        await queuePersistence(() => persistEnhancedDrawing(drawing, scope));
        setStatus(locked ? '画图已解锁。' : '画图已锁定。');
      } catch (error) {
        setStatus(error.message || '锁定状态保存失败', true);
      }
      return;
    }
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
      const scope = drawingScopeObject();
      await queuePersistence(() => persistDrawing(updated, scope));
      state.selectedId = '';
      state.selectedLocked = false;
      updateDrawingButtons();
      setStatus(locked ? '画图已锁定。' : '画图已解锁。');
    } catch (error) {
      setStatus(error.message || '锁定状态保存失败', true);
    }
  }

  async function persistDrawing(drawing, scope = drawingScopeObject()) {
    return fetch('/api/chart/drawings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...scope,
        ...drawing,
      }),
    }).then(readJson);
  }

  function persistedEnhancedDrawing(drawing) {
    return {
      id: drawing.id,
      toolType: ENHANCED_TYPE_MAP[drawing.type],
      points: drawing.anchors.map((anchor) => ({ timestamp: Number(anchor.time), price: Number(anchor.price) })),
      options: {
        __enhancedDrawing: true,
        style: { ...drawing.style },
        drawingOptions: { ...drawing.options },
      },
    };
  }

  function persistEnhancedDrawing(drawing, scope = drawingScopeObject()) {
    return persistDrawing(persistedEnhancedDrawing(drawing), scope);
  }

  function importEnhancedDrawing(saved) {
    const toolType = Object.keys(ENHANCED_TYPE_MAP).find((key) => ENHANCED_TYPE_MAP[key] === saved.toolType);
    if (!toolType) return null;
    const anchors = (saved.points || []).map((point) => ({ time: Number(point.timestamp), price: Number(point.price) }));
    const stored = {
      style: saved.options?.style || enhancedStyle(toolType),
      options: saved.options?.drawingOptions || enhancedOptions(toolType),
    };
    const drawing = createEnhancedDrawing(toolType, saved.id, anchors, false, '', stored);
    if (drawing) state.enhancedDrawings.addDrawing(drawing);
    return drawing;
  }

  async function deleteSelectedDrawing() {
    const id = state.selectedId;
    if (!id || id === SYSTEM_MARKER_ID) return;
    const selectedEngine = state.selectedEngine;
    const params = new URLSearchParams({ ...drawingScopeObject(), id });
    invalidatePendingDrawingSaves();
    try {
      await queuePersistence(() => fetch(`/api/chart/drawings?${params}`, { method: 'DELETE' }).then(readJson));
      if (selectedEngine === 'enhanced') state.enhancedDrawings.removeDrawing(id);
      else state.lineTools.removeLineToolsById([id]);
      state.drawingIds.delete(id);
      recordDrawingHistory(currentDrawingSnapshot());
      state.selectedId = '';
      state.selectedEngine = '';
      state.selectedLocked = false;
      updateDrawingButtons();
      setStatus('已删除选中的画图。');
    } catch (error) {
      setStatus(error.message || '删除失败', true);
    }
  }

  async function clearDrawings() {
    if (state.clearingDrawings || state.loadingDrawings || !state.drawingIds.size
      || !window.confirm(`清空 ${state.symbol} 在所有视频和周期下的全部画图？`)) return;
    const params = drawingScopeParams();
    state.clearingDrawings = true;
    invalidatePendingDrawingSaves();
    cancelActiveDrawing();
    updateDrawingButtons();
    try {
      await queuePersistence(() => fetch(`/api/chart/drawings?${params}`, { method: 'DELETE' }).then(readJson));
      state.lineTools.removeAllLineTools();
      state.enhancedDrawings.clearAll();
      state.drawingIds.clear();
      recordDrawingHistory('[]');
      state.selectedId = '';
      state.selectedEngine = '';
      state.selectedLocked = false;
      addVideoPublishedMarker();
      setStatus(`${state.symbol} 的全部用户画图已清空。`);
    } catch (error) {
      setStatus(error.message || '清空失败', true);
    } finally {
      state.clearingDrawings = false;
      updateDrawingButtons();
    }
  }

  function currentDrawingSnapshot() {
    if (!state.lineTools) return '[]';
    const legacy = JSON.parse(state.lineTools.exportLineTools() || '[]')
      .filter((drawing) => drawing.id !== SYSTEM_MARKER_ID && LEGACY_TOOL_TYPES.has(drawing.toolType))
      .map(normalizeDrawingStyle);
    const enhanced = (state.enhancedDrawings?.getAllDrawings() || [])
      .filter((drawing) => drawing.id !== '__enhanced-preview' && Object.hasOwn(ENHANCED_TYPE_MAP, drawing.type))
      .map(persistedEnhancedDrawing);
    const drawings = [...legacy, ...enhanced].sort((left, right) => left.id.localeCompare(right.id));
    return JSON.stringify(drawings);
  }

  function resetDrawingHistory(drawings) {
    const normalized = [...drawings]
      .filter((drawing) => drawing.id !== SYSTEM_MARKER_ID && USER_TOOL_TYPES.has(drawing.toolType))
      .map((drawing) => LEGACY_TOOL_TYPES.has(drawing.toolType) ? normalizeDrawingStyle(drawing) : drawing)
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
      state.enhancedDrawings.clearAll();
      state.drawingIds.clear();
      const legacy = drawings.filter((drawing) => LEGACY_TOOL_TYPES.has(drawing.toolType));
      const enhanced = drawings.filter((drawing) => ENHANCED_TOOL_TYPES.has(drawing.toolType));
      if (legacy.length && !state.lineTools.importLineTools(JSON.stringify(legacy))) {
        throw new Error('画图历史无法恢复。');
      }
      enhanced.forEach(importEnhancedDrawing);
      state.drawingIds = new Set(drawings.map((drawing) => drawing.id));
      state.selectedId = '';
      state.selectedLocked = false;
      const scope = drawingScopeObject();
      await queuePersistence(() => replacePersistedDrawings(drawings, scope));
      state.historySnapshot = snapshot;
      setStatus(message);
    } catch (error) {
      setStatus(error.message || '画图历史恢复失败', true);
    } finally {
      state.restoringHistory = false;
      updateDrawingButtons();
    }
  }

  function replacePersistedDrawings(drawings, scope = drawingScopeObject()) {
    return fetch('/api/chart/drawings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...scope, drawings }),
    }).then(readJson);
  }

  function queuePersistence(task) {
    state.persistenceQueue = state.persistenceQueue.catch(() => {}).then(task);
    return state.persistenceQueue;
  }

  function invalidatePendingDrawingSaves() {
    state.drawingPersistenceEpoch += 1;
    if (state.enhancedSaveTimer) window.clearTimeout(state.enhancedSaveTimer);
    state.enhancedSaveTimer = null;
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
        showTimeAxisLabels: false,
        timeAxisLabelAlwaysVisible: false,
        line: { color: '#fb7185', width: 1, style: window.LightweightCharts.LineStyle.Dashed },
        text: { value: '' },
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
    elements.clearDrawings.disabled = state.clearingDrawings || state.loadingDrawings || state.drawingIds.size === 0;
    elements.clearDrawings.title = state.clearingDrawings
      ? '正在清空画图…'
      : state.loadingDrawings
        ? '正在加载当前交易对的画图，请稍候'
        : '清空当前交易对在所有视频和周期下的全部画图';
    document.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.drawingTool === state.activeToolType);
    });
    document.querySelectorAll('[data-enhanced-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.enhancedTool === state.activeToolType);
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
    return { videoId: '__global__', symbol: state.symbol, interval: state.interval };
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

  function beijingDateString(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function toCamel(value) {
    return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
  }

  function isTextInput(target) {
    return target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  window.TiaReviewChart = { init, open, openReplay, close };
}());
