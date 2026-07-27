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
    offlineMode: true,
    logarithmicScale: false,
    allSymbols: [],
    paperTrades: [],
    chart: null,
    series: null,
    volumeSeries: null,
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
    replayOrigin: '',
    replayReady: false,
    replayStartIndex: 0,
    replayVisibleCount: 0,
    replayCursorTimestamp: 0,
    replayHasMore: false,
    loadingLater: false,
    replaySpeed: 1,
    replayTimer: null,
    reloadEpoch: 0,
    reloadAbortController: null,
    earlierAbortController: null,
    laterAbortController: null,
    reviewCutoffTimestamp: 0,
    reviewHasMoreLater: false,
    reviewRightLoadArmed: false,
    settlingPaperTrades: false,
  };

  const elements = {};

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    [
      'review-dialog', 'review-video-title', 'review-video-time', 'chart-symbol', 'chart-interval',
      'price-scale-mode', 'offline-mode', 'close-review', 'review-chart', 'chart-loading',
      'chart-status', 'chart-cutoff', 'undo-drawing', 'redo-drawing',
      'lock-drawing', 'delete-drawing', 'clear-drawings', 'drawing-tools-handle',
      'replay-controls', 'replay-date', 'start-replay', 'toggle-replay', 'step-replay',
      'replay-speed', 'replay-progress',
      'drawing-input-layer', 'chart-candle-data', 'candle-open', 'candle-high',
      'candle-low', 'candle-close', 'candle-change',
      'open-journal-btn', 'journal-drawer', 'close-journal-btn', 'clear-journal-btn',
      'journal-total-trades', 'journal-win-rate', 'journal-total-r', 'journal-avg-rr',
      'journal-table-body', 'custom-symbol-dialog', 'custom-symbol-input',
      'custom-symbol-msg', 'confirm-add-symbol', 'cancel-add-symbol',
    ].forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });
    elements.drawingTools = document.querySelector('.drawing-tools');
    elements.chartStage = document.querySelector('.chart-stage');
    elements.reviewDialog.tabIndex = -1;

    elements.closeReview.addEventListener('click', close);
    elements.chartSymbol.addEventListener('change', () => {
      if (elements.chartSymbol.value === '__add__') {
        renderSymbolSelectorOptions();
        openCustomSymbolDialog();
        return;
      }
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
    elements.offlineMode.addEventListener('change', saveOfflineMode);
    elements.priceScaleMode.addEventListener('click', togglePriceScaleMode);
    const armReviewLaterLoad = () => {
      if (state.mode === 'review') state.reviewRightLoadArmed = true;
    };
    elements.reviewChart.addEventListener('pointerdown', armReviewLaterLoad);
    elements.reviewChart.addEventListener('wheel', armReviewLaterLoad, { passive: true });
    elements.replayDate.addEventListener('change', resetReplaySelection);
    elements.startReplay.addEventListener('click', startReplayFromSelection);
    elements.toggleReplay.addEventListener('click', toggleReplayPlayback);
    elements.stepReplay.addEventListener('click', () => void stepReplay(true));
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
    elements.openJournalBtn.addEventListener('click', openJournalDrawer);
    elements.closeJournalBtn.addEventListener('click', closeJournalDrawer);
    elements.clearJournalBtn.addEventListener('click', clearPaperTrades);
    elements.confirmAddSymbol.addEventListener('click', handleAddCustomSymbol);
    elements.cancelAddSymbol.addEventListener('click', () => elements.customSymbolDialog.close());
    elements.customSymbolInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void handleAddCustomSymbol();
    });
    elements.journalTableBody.addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-trade-id]');
      if (button) void deletePaperTrade(button.dataset.deleteTradeId);
    });
    initializeDraggableToolbar();
    restorePriceScaleMode();
  }

  async function open(video) {
    init();
    stopReplayPlayback();
    state.mode = 'replay';
    state.replayOrigin = 'video';
    state.replayReady = false;
    state.replayVisibleCount = 0;
    state.replayCursorTimestamp = 0;
    state.replayHasMore = true;
    state.reviewCutoffTimestamp = 0;
    state.reviewHasMoreLater = false;
    state.reviewRightLoadArmed = false;
    state.replaySpeed = 1;
    elements.replayControls.hidden = false;
    elements.replayDate.max = beijingDateString(new Date());
    elements.replaySpeed.value = '1';
    if (!elements.reviewDialog.open) elements.reviewDialog.showModal();
    ensureChart();
    await Promise.all([loadChartConfig(), loadSymbolsList()]);
    await beginVideoReplay(video);
  }

  async function openReplay() {
    init();
    stopReplayPlayback();
    state.mode = 'replay';
    state.replayOrigin = 'date';
    state.video = null;
    state.anchor = 0;
    state.replayDate = '';
    state.replayReady = false;
    state.replayCursorTimestamp = 0;
    state.replayHasMore = false;
    state.reviewCutoffTimestamp = 0;
    state.reviewHasMoreLater = false;
    state.reviewRightLoadArmed = false;
    state.replaySpeed = 1;
    elements.replayControls.hidden = false;
    elements.replayDate.max = beijingDateString(new Date());
    elements.replayDate.value = elements.replayDate.max;
    elements.replaySpeed.value = '1';
    elements.reviewVideoTitle.textContent = '多币种行情复盘';
    elements.reviewVideoTime.textContent = '选择日期后，从北京时间 00:00 开始逐根回放 · 无固定结束时间';
    if (!elements.reviewDialog.open) elements.reviewDialog.showModal();
    ensureChart();
    await Promise.all([loadChartConfig(), loadSymbolsList()]);
    resetReplaySelection();
  }

  async function loadChartConfig() {
    try {
      const response = await fetch('/api/chart/config');
      const config = await readJson(response);
      state.offlineMode = config.offlineMode !== false;
      elements.offlineMode.checked = state.offlineMode;
    } catch (error) {
      setStatus('读取图表配置失败，暂用仅本地模式。', true);
    }
  }

  function close() {
    stopReplayPlayback();
    state.reloadEpoch += 1;
    state.reloadAbortController?.abort();
    state.earlierAbortController?.abort();
    state.laterAbortController?.abort();
    if (document.body.dataset.reviewStandalone === 'true') {
      window.close();
      if (!window.closed) window.location.href = '/';
      return;
    }
    elements.reviewDialog.close();
  }

  function getChartThemeOptions() {
    const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
    return {
      layout: {
        background: { type: window.LightweightCharts.ColorType.Solid, color: isDark ? '#0b0e14' : '#ffffff' },
        textColor: isDark ? '#94a3b8' : '#475569',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' },
        horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' },
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#d9e1ec',
        mode: state.logarithmicScale
          ? window.LightweightCharts.PriceScaleMode.Logarithmic
          : window.LightweightCharts.PriceScaleMode.Normal,
      },
      timeScale: { borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#d9e1ec', timeVisible: true, secondsVisible: false, rightOffset: 8 },
    };
  }

  function applyChartTheme() {
    if (!state.chart) return;
    state.chart.applyOptions(getChartThemeOptions());
  }


  async function loadSymbolsList() {
    try {
      const res = await fetch('/api/symbols').then(readJson);
      state.allSymbols = res.symbols || [];
      renderSymbolSelectorOptions();
    } catch (_) {}
  }

  function renderSymbolSelectorOptions() {
    if (!elements.chartSymbol || !Array.isArray(state.allSymbols) || state.allSymbols.length === 0) return;
    const currentVal = state.symbol;
    const presets = state.allSymbols.filter((item) => !item.custom);
    const customs = state.allSymbols.filter((item) => item.custom);

    let html = '<optgroup label="热门标的">';
    presets.forEach((item) => {
      html += `<option value="${item.symbol}" ${item.symbol === currentVal ? 'selected' : ''}>${item.name}</option>`;
    });
    html += '</optgroup>';

    if (customs.length > 0) {
      html += '<optgroup label="我的自定义">';
      customs.forEach((item) => {
        html += `<option value="${item.symbol}" ${item.symbol === currentVal ? 'selected' : ''}>${item.name}</option>`;
      });
      html += '</optgroup>';
    }

    html += '<optgroup label="更多操作"><option value="__add__">＋ 添加新合约…</option></optgroup>';
    elements.chartSymbol.innerHTML = html;
  }

  function openCustomSymbolDialog() {
    if (!elements.customSymbolDialog) return;
    elements.customSymbolInput.value = '';
    elements.customSymbolMsg.textContent = '';
    elements.customSymbolMsg.classList.remove('error');
    elements.customSymbolDialog.showModal();
    elements.customSymbolInput.focus();
  }

  async function handleAddCustomSymbol() {
    const symbol = (elements.customSymbolInput.value || '').trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3,15}USDT$/.test(symbol)) {
      elements.customSymbolMsg.textContent = '合约代码格式无效，请输入如 SOLUSDT 的代码。';
      elements.customSymbolMsg.classList.add('error');
      return;
    }
    elements.customSymbolMsg.textContent = '正在验证交易所合约有效性…';
    elements.customSymbolMsg.classList.remove('error');
    try {
      const res = await fetch('/api/symbols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      }).then(readJson);
      elements.customSymbolDialog.close();
      await loadSymbolsList();
      state.symbol = res.symbol;
      renderSymbolSelectorOptions();
      void reloadScope();
    } catch (err) {
      elements.customSymbolMsg.textContent = err.message || '添加合约失败，请检查名称。';
      elements.customSymbolMsg.classList.add('error');
    }
  }

  function getSelectedPositionToolInfo() {
    const selected = state.enhancedDrawings?.getSelectedDrawing();
    if (!selected || (selected.type !== 'long-position' && selected.type !== 'short-position')) return null;
    const anchors = selected.anchors || [];
    if (anchors.length < 3) return null;
    const entry = Number(anchors[0].price);
    const sl = Number(anchors[1].price);
    const tp = Number(anchors[2].price);
    const isLong = selected.type === 'long-position';
    if (![entry, tp, sl].every((price) => Number.isFinite(price) && price > 0)) return null;
    if (isLong ? !(tp > entry && entry > sl) : !(tp < entry && entry < sl)) return null;
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr = Number((reward / risk).toFixed(2));
    return {
      type: isLong ? 'LONG' : 'SHORT',
      entryPrice: entry,
      tpPrice: tp,
      slPrice: sl,
      rrRatio: rr,
    };
  }

  function updatePaperTradeButton() {
    const posInfo = getSelectedPositionToolInfo();
    const tradeBtn = document.getElementById('record-paper-trade-btn');
    if (posInfo) {
      if (!tradeBtn) {
        const btn = document.createElement('button');
        btn.id = 'record-paper-trade-btn';
        btn.type = 'button';
        btn.className = 'trade-record-btn';
        btn.textContent = '🎯 模拟开仓';
        btn.title = `以当前仓位参数录单 (${posInfo.type === 'LONG' ? '做多' : '做空'} R:R=${posInfo.rrRatio})`;
        btn.onclick = createPaperTradeFromPositionTool;
        elements.drawingTools.appendChild(btn);
      }
    } else if (tradeBtn) {
      tradeBtn.remove();
    }
  }

  async function createPaperTradeFromPositionTool() {
    const info = getSelectedPositionToolInfo();
    if (!info) {
      setStatus('请先在图表上选中做多或做空仓位标注框。', true);
      return;
    }
    const currentCandle = latestVisibleCandle();
    const simulatedOpenedAt = currentCandle
      ? (Number(currentCandle.time) + INTERVAL_SECONDS[state.interval]) * 1000
      : Date.now();
    const tradePayload = {
      id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      videoId: state.video?.['视频ID'] || '__global__',
      symbol: state.symbol,
      interval: state.interval,
      direction: info.type,
      entryPrice: info.entryPrice,
      tpPrice: info.tpPrice,
      slPrice: info.slPrice,
      rrRatio: info.rrRatio,
      status: 'OPEN',
      pnlR: 0,
      createdAt: new Date(simulatedOpenedAt).toISOString(),
    };
    try {
      await fetch('/api/paper-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradePayload),
      }).then(readJson);
      setStatus(`🎯 模拟交易录单成功！${info.type === 'LONG' ? '做多' : '做空'} ${state.symbol} (R:R = ${info.rrRatio})`);
      void checkPaperTradesSettlement();
      void refreshJournalDrawer();
    } catch (err) {
      setStatus(err.message || '模拟交易录单失败', true);
    }
  }

  async function checkPaperTradesSettlement() {
    if (state.settlingPaperTrades || !Array.isArray(state.candleData) || state.candleData.length === 0) return;
    state.settlingPaperTrades = true;
    try {
      const res = await fetch(`/api/paper-trades?symbol=${state.symbol}`).then(readJson);
      const trades = res.trades || [];
      state.paperTrades = trades;

      const openTrades = trades.filter((t) => t.status === 'OPEN');
      if (openTrades.length === 0) return;

      const visibleCandles = state.mode === 'replay'
        ? state.candleData.slice(0, state.replayVisibleCount)
        : state.candleData;

      let settledCount = 0;

      for (const trade of openTrades) {
        const openedAtSeconds = Date.parse(trade.created_at) / 1000;
        const settlementCandles = visibleCandles.filter((candle) => (
          !Number.isFinite(openedAtSeconds) || Number(candle.time) >= openedAtSeconds
        ));
        for (const candle of settlementCandles) {
          const high = Number(candle.high);
          const low = Number(candle.low);
          let newStatus = null;
          let pnlR = 0;

          if (trade.direction === 'LONG') {
            if (low <= trade.sl_price) {
              newStatus = 'LOSS';
              pnlR = -1.0;
            } else if (high >= trade.tp_price) {
              newStatus = 'WIN';
              pnlR = trade.rr_ratio;
            }
          } else if (trade.direction === 'SHORT') {
            if (high >= trade.sl_price) {
              newStatus = 'LOSS';
              pnlR = -1.0;
            } else if (low <= trade.tp_price) {
              newStatus = 'WIN';
              pnlR = trade.rr_ratio;
            }
          }

          if (newStatus) {
            trade.status = newStatus;
            trade.pnlR = pnlR;
            trade.closedAt = new Date(
              (Number(candle.time) + INTERVAL_SECONDS[trade.interval]) * 1000,
            ).toISOString();
            settledCount++;
            await fetch('/api/paper-trades', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: trade.id,
                videoId: trade.video_id,
                symbol: trade.symbol,
                interval: trade.interval,
                direction: trade.direction,
                entryPrice: trade.entry_price,
                tpPrice: trade.tp_price,
                slPrice: trade.sl_price,
                rrRatio: trade.rr_ratio,
                status: newStatus,
                pnlR: pnlR,
                closedAt: trade.closedAt,
              }),
            });
            setStatus(`${newStatus === 'WIN' ? '🎉 止盈结算！' : '🔻 止损结算！'} ${trade.symbol} ${trade.direction === 'LONG' ? '做多' : '做空'} (${pnlR > 0 ? '+' : ''}${pnlR}R)`);
            break;
          }
        }
      }

      if (settledCount > 0) void refreshJournalDrawer();
    } catch (error) {
      console.warn('模拟交易结算检查失败：', error);
    } finally {
      state.settlingPaperTrades = false;
    }
  }

  function openJournalDrawer() {
    elements.journalDrawer.hidden = false;
    void refreshJournalDrawer();
  }

  function closeJournalDrawer() {
    elements.journalDrawer.hidden = true;
  }

  async function deletePaperTrade(tradeId) {
    if (!tradeId || !window.confirm('确认删除这条模拟交易记录？')) return;
    try {
      const params = new URLSearchParams({ id: tradeId });
      await fetch(`/api/paper-trades?${params}`, { method: 'DELETE' }).then(readJson);
      await refreshJournalDrawer();
    } catch (error) {
      setStatus(error.message || '删除模拟交易记录失败。', true);
    }
  }

  async function clearPaperTrades() {
    if (!window.confirm('确认清空所有模拟交易记录？此操作不可撤销。')) return;
    try {
      await fetch('/api/paper-trades', { method: 'DELETE' }).then(readJson);
      await refreshJournalDrawer();
    } catch (error) {
      setStatus(error.message || '清空模拟交易记录失败。', true);
    }
  }

  async function refreshJournalDrawer() {
    if (!elements.journalDrawer) return;
    try {
      const res = await fetch('/api/paper-trades').then(readJson);
      const trades = res.trades || [];
      state.paperTrades = trades;

      const total = trades.length;
      const closed = trades.filter((t) => t.status !== 'OPEN');
      const wins = closed.filter((t) => t.status === 'WIN').length;
      const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;
      const totalR = closed.reduce((acc, t) => acc + (Number(t.pnl_r) || 0), 0);
      const winTrades = closed.filter((t) => t.status === 'WIN');
      const avgRR = winTrades.length > 0
        ? (winTrades.reduce((acc, t) => acc + Number(t.rr_ratio || 0), 0) / winTrades.length).toFixed(2)
        : '0.00';

      elements.journalTotalTrades.textContent = total;
      elements.journalWinRate.textContent = `${winRate}%`;
      elements.journalTotalR.textContent = `${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)} R`;
      elements.journalAvgRr.textContent = avgRR;

      const tbody = elements.journalTableBody;
      if (trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty">暂无模拟交易记录。在图表拉出做多/做空工具即可录单。</td></tr>';
        return;
      }

      tbody.innerHTML = trades.map((t) => {
        const timeStr = t.created_at ? new Date(t.created_at).toLocaleDateString() : '--';
        const isLong = t.direction === 'LONG';
        const tagDir = isLong ? '<span class="tag-long">做多</span>' : '<span class="tag-short">做空</span>';
        let tagStatus = '<span class="tag-open">持仓中</span>';
        if (t.status === 'WIN') tagStatus = `<span class="tag-win">止盈 +${t.pnl_r}R</span>`;
        if (t.status === 'LOSS') tagStatus = `<span class="tag-loss">止损 -1.0R</span>`;

        return `<tr>
          <td>${escapeHtml(timeStr)}</td>
          <td><strong>${escapeHtml(t.symbol)}</strong></td>
          <td>${tagDir}</td>
          <td>${escapeHtml(t.entry_price)}</td>
          <td>${escapeHtml(t.tp_price)}</td>
          <td>${escapeHtml(t.sl_price)}</td>
          <td>${escapeHtml(t.rr_ratio)}</td>
          <td>${tagStatus}</td>
          <td><button type="button" class="danger-btn" data-delete-trade-id="${escapeHtml(t.id)}">删除</button></td>
        </tr>`;
      }).join('');
    } catch (error) {
      setStatus(error.message || '读取模拟交易记录失败。', true);
    }
  }

  function ensureChart() {
    if (state.chart) {
      applyChartTheme();
      resizeChart();
      return;
    }
    if (!window.LightweightCharts) {
      setStatus('图表组件未加载，请刷新页面。', true);
      return;
    }
    const themeOpts = getChartThemeOptions();
    state.chart = window.LightweightCharts.createChart(elements.reviewChart, {
      width: elements.reviewChart.clientWidth,
      height: elements.reviewChart.clientHeight,
      layout: themeOpts.layout,
      grid: themeOpts.grid,
      rightPriceScale: themeOpts.rightPriceScale,
      timeScale: themeOpts.timeScale,
      crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal },
      localization: { locale: 'zh-CN', timeFormatter: formatChartTime },
    });
    const options = {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    };
    state.series = typeof state.chart.addSeries === 'function'
      ? state.chart.addSeries(window.LightweightCharts.CandlestickSeries, options)
      : state.chart.addCandlestickSeries(options);
    initializeVolumeSeries();
    initializeLineTools();
    initializeEnhancedDrawingManager();
    state.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && range.from < 40) void loadEarlierCandles();
      if (range && shouldLoadLaterReviewCandles(range)) void loadLaterReviewCandles();
    });
    state.chart.subscribeCrosshairMove((param) => {
      const candle = param.seriesData?.get(state.series);
      updateCandleData(candle || latestVisibleCandle());
    });
    // 双击 K 线触发定位切入
    elements.reviewChart.addEventListener('dblclick', (event) => {
      if (state.activeToolType || state.activeDrawingId) return;
      const rect = elements.reviewChart.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const time = state.chart.timeScale().coordinateToTime(x);
      if (time === null || time === undefined) return;
      const timeNum = Number(time);
      const candle = state.candleData.find((c) => Number(c.time) === timeNum);
      if (candle && Number.isFinite(candle.open)) cutInAtCandle(candle);
    });
    state.resizeObserver = new ResizeObserver(() => {
      resizeChart();
    });
    state.resizeObserver.observe(elements.reviewChart);

    // Watch theme changes
    const themeObserver = new MutationObserver(() => applyChartTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function resizeChart() {
    if (!state.chart) return;
    state.chart.applyOptions({ width: elements.reviewChart.clientWidth, height: elements.reviewChart.clientHeight });
    constrainToolbarPosition();
  }

  function initializeVolumeSeries() {
    const options = {
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    };
    if (typeof state.chart.addSeries === 'function' && window.LightweightCharts.HistogramSeries) {
      state.volumeSeries = state.chart.addSeries(
        window.LightweightCharts.HistogramSeries,
        options,
        1,
      );
      const panes = state.chart.panes?.() || [];
      panes[0]?.setStretchFactor?.(4);
      panes[1]?.setStretchFactor?.(1);
      applyVolumeScaleMode();
      return;
    }
    if (typeof state.chart.addHistogramSeries === 'function') {
      state.volumeSeries = state.chart.addHistogramSeries({
        ...options,
        priceScaleId: '',
      });
      state.volumeSeries.priceScale().applyOptions({
        mode: window.LightweightCharts.PriceScaleMode.Normal,
        autoScale: true,
        scaleMargins: { top: 0.8, bottom: 0 },
      });
    }
  }

  function applyVolumeScaleMode() {
    if (!state.volumeSeries) return;
    const separatePane = (state.chart.panes?.().length || 0) > 1;
    state.volumeSeries.priceScale().applyOptions({
      mode: window.LightweightCharts.PriceScaleMode.Normal,
      autoScale: true,
      scaleMargins: separatePane ? { top: 0.1, bottom: 0 } : { top: 0.8, bottom: 0 },
    });
  }

  function togglePriceScaleMode() {
    state.logarithmicScale = !state.logarithmicScale;
    applyPriceScaleMode();
    try {
      localStorage.setItem(PRICE_SCALE_MODE_KEY, state.logarithmicScale ? 'logarithmic' : 'normal');
    } catch (_) {
      // Private browsing
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
    elements.priceScaleMode.classList.toggle('active', state.logarithmicScale);
    elements.priceScaleMode.setAttribute('aria-pressed', String(state.logarithmicScale));
    elements.priceScaleMode.title = state.logarithmicScale ? '切换为线性价格坐标' : '切换为对数价格坐标';
    if (state.chart) {
      state.chart.priceScale('right').applyOptions({
        mode: state.logarithmicScale
          ? window.LightweightCharts.PriceScaleMode.Logarithmic
          : window.LightweightCharts.PriceScaleMode.Normal,
      });
      applyVolumeScaleMode();
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
    let position = { left: 10, top: 52 };
    try {
      position = { ...position, ...JSON.parse(localStorage.getItem(TOOLBAR_POSITION_KEY) || '{}') };
    } catch (_) {
      // Ignore invalid or unavailable local state and use the default position.
    }
    const left = Number(position.left) || 10;
    const savedTop = Number(position.top) || 52;
    const top = left <= 12 && savedTop <= 12 ? 52 : savedTop;
    positionToolbar(left, top);
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
    state.reloadAbortController?.abort();
    state.earlierAbortController?.abort();
    state.laterAbortController?.abort();
    state.earlierAbortController = null;
    state.laterAbortController = null;
    const reloadEpoch = ++state.reloadEpoch;
    const abortController = new AbortController();
    state.reloadAbortController = abortController;
    const requestedSymbol = state.symbol;
    const requestedInterval = state.interval;
    const requestedMode = state.mode;
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
    state.loadingLater = false;
    state.reviewHasMoreLater = false;
    state.reviewRightLoadArmed = false;
    state.candleData = [];
    state.loadingDrawings = true;
    showLoading(`正在读取 ${state.symbol} ${INTERVAL_LABELS[state.interval]} K 线…`);
    let drawingsLoaded = false;
    try {
      const params = new URLSearchParams({ symbol: state.symbol, interval: state.interval });
      if (state.mode === 'replay') {
        params.set('replayCursor', String(state.replayCursorTimestamp || state.anchor));
        params.set('limit', '1000');
      } else {
        params.set('anchor', String(state.anchor));
      }
      const [candleResult, drawingResult] = await Promise.allSettled([
        fetch(`/api/chart/candles?${params}`, { signal: abortController.signal }).then(readJson),
        fetch(`/api/chart/drawings?${drawingScopeParams()}`, { signal: abortController.signal }).then(readJson),
      ]);
      if (reloadEpoch !== state.reloadEpoch
        || requestedSymbol !== state.symbol
        || requestedInterval !== state.interval
        || requestedMode !== state.mode) return;
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
        const cursorSeconds = Math.floor((state.replayCursorTimestamp || state.anchor) / 1000);
        const firstFutureIndex = state.candleData.findIndex((candle) => Number(candle.time) + INTERVAL_SECONDS[state.interval] > cursorSeconds);
        state.replayVisibleCount = firstFutureIndex < 0 ? state.candleData.length : firstFutureIndex;
        state.replayStartIndex = state.replayVisibleCount;
        state.replayReady = state.replayVisibleCount > 0;
        state.replayHasMore = candlePayload.hasMore !== false;
      } else {
        state.reviewCutoffTimestamp = Number(candlePayload.effectiveCutoff || candlePayload.requestedCutoff || 0);
        state.reviewHasMoreLater = candlePayload.hasMoreLater === true;
      }
      const legacyDrawings = drawings.filter((drawing) => LEGACY_TOOL_TYPES.has(drawing.toolType)).map(normalizeDrawingStyle);
      const enhancedDrawings = drawings.filter((drawing) => ENHANCED_TOOL_TYPES.has(drawing.toolType));
      renderCandleData(drawingAnchorTimesFromPayload(drawings));
      if (legacyDrawings.length && !state.lineTools.importLineTools(JSON.stringify(legacyDrawings))) {
        throw new Error('已保存的画图数据无法导入。');
      }
      enhancedDrawings.forEach(importEnhancedDrawing);
      addVideoPublishedMarker();
      setInitialVisibleRange();
      const cacheLabel = candlePayload.source === 'bybit' ? 'Bybit 已写入 SQLite' : '已从 SQLite 读取';
      if (state.mode === 'replay') {
        elements.chartCutoff.textContent = state.replayOrigin === 'video'
          ? `初始截止：视频发布时间 ${formatTimestamp(state.anchor)} · 按 → 逐根揭示`
          : `起点：${formatTimestamp(state.anchor)} · 后续 K 线按需加载至最新可用行情`;
        const hiddenCount = Math.max(0, state.candleData.length - state.replayStartIndex);
        setStatus(candlePayload.warning ? `${cacheLabel}；${candlePayload.warning}` : `准备完成 · 已隐藏后续 ${hiddenCount} 根 K 线 · 播放到边界会自动续载`, Boolean(candlePayload.warning));
        updateReplayControls();
      } else {
        elements.chartCutoff.textContent = `严格截止：视频发布时间 ${formatTimestamp(state.anchor)}`;
        const laterLabel = state.reviewHasMoreLater ? ' · 向右拖动按需加载后续数据' : '';
        setStatus(candlePayload.warning ? `${cacheLabel}；${candlePayload.warning}` : `${cacheLabel} · ${candles.length} 根 K 线 · 向左拖动自动加载更早数据${laterLabel}`, Boolean(candlePayload.warning));
      }
      updateDrawingButtons();
    } catch (error) {
      if (reloadEpoch !== state.reloadEpoch || error?.name === 'AbortError') return;
      state.series.setData([]);
      state.volumeSeries?.setData([]);
      state.candleData = [];
      updateCandleData(null);
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
      if (reloadEpoch === state.reloadEpoch) {
        state.reloadAbortController = null;
        state.loadingDrawings = false;
        updateDrawingButtons();
        hideLoading();
      }
    }
  }

  async function loadEarlierCandles() {
    if (state.loadingEarlier || state.noMoreEarlier || !state.candleData.length) return;
    state.loadingEarlier = true;
    const reloadEpoch = state.reloadEpoch;
    const symbol = state.symbol;
    const interval = state.interval;
    const abortController = new AbortController();
    state.earlierAbortController = abortController;
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
      const payload = await fetch(`/api/chart/candles?${params}`, { signal: abortController.signal }).then(readJson);
      if (reloadEpoch !== state.reloadEpoch || symbol !== state.symbol || interval !== state.interval) return;
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
      if (error?.name === 'AbortError' || reloadEpoch !== state.reloadEpoch) return;
      setStatus(error.message || '更早 K 线加载失败，请稍后重试', true);
    } finally {
      if (reloadEpoch === state.reloadEpoch) {
        state.earlierAbortController = null;
        state.loadingEarlier = false;
      }
    }
  }

  function shouldLoadLaterReviewCandles(visibleRange) {
    if (state.mode !== 'review'
      || !state.reviewRightLoadArmed
      || !state.reviewHasMoreLater
      || state.loadingLater
      || !state.candleData.length) return false;
    const lastCandle = state.candleData[state.candleData.length - 1];
    const lastIndex = state.chart.timeScale().timeToIndex(lastCandle.time, true);
    return Number.isFinite(lastIndex) && visibleRange.to >= lastIndex - 20;
  }

  async function loadLaterReviewCandles() {
    if (state.mode !== 'review' || state.loadingLater || !state.reviewHasMoreLater || !state.candleData.length) return;
    state.loadingLater = true;
    state.reviewRightLoadArmed = false;
    state.laterAbortController?.abort();
    const abortController = new AbortController();
    state.laterAbortController = abortController;
    const reloadEpoch = state.reloadEpoch;
    const symbol = state.symbol;
    const interval = state.interval;
    const cutoff = state.reviewCutoffTimestamp;
    const after = Number(state.candleData[state.candleData.length - 1].time) * 1000;
    const visibleRange = state.chart.timeScale().getVisibleLogicalRange();
    setStatus(`正在加载后续 ${INTERVAL_LABELS[interval]} K 线…`);
    try {
      const params = new URLSearchParams({
        symbol,
        interval,
        after: String(after),
        cutoff: String(cutoff),
        limit: '1000',
      });
      const payload = await fetch(`/api/chart/candles?${params}`, { signal: abortController.signal }).then(readJson);
      if (reloadEpoch !== state.reloadEpoch || symbol !== state.symbol || interval !== state.interval || state.mode !== 'review') return;
      const knownTimes = new Set(state.candleData.map((candle) => Number(candle.time)));
      const later = (payload.candles || [])
        .map(toChartCandle)
        .filter((candle) => !knownTimes.has(Number(candle.time)))
        .sort((left, right) => Number(left.time) - Number(right.time));
      state.reviewHasMoreLater = payload.hasMore !== false;
      state.reviewRightLoadArmed = state.reviewHasMoreLater;
      if (!later.length) {
        state.reviewHasMoreLater = false;
        setStatus(payload.warning || '已加载至最新可用行情。', Boolean(payload.warning));
        return;
      }
      state.candleData.push(...later);
      renderCandleData();
      if (visibleRange) state.chart.timeScale().setVisibleLogicalRange(visibleRange);
      const cacheLabel = payload.source === 'bybit' ? '后续数据已写入 SQLite' : '后续数据已从 SQLite 读取';
      const suffix = state.reviewHasMoreLater ? ' · 继续向右拖动可加载更多' : ' · 已到最新可用行情';
      setStatus(payload.warning ? `${cacheLabel}；${payload.warning}` : `${cacheLabel} · 当前共 ${state.candleData.length} 根${suffix}`, Boolean(payload.warning));
    } catch (error) {
      if (error?.name === 'AbortError' || reloadEpoch !== state.reloadEpoch) return;
      setStatus(error.message || '后续 K 线加载失败，请稍后重试', true);
    } finally {
      if (reloadEpoch === state.reloadEpoch) {
        state.laterAbortController = null;
        state.loadingLater = false;
      }
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

  function toVolumePoint(candle) {
    return {
      time: candle.time,
      value: Number(candle.volume) || 0,
      color: Number(candle.close) >= Number(candle.open)
        ? 'rgba(38, 166, 154, 0.62)'
        : 'rgba(239, 83, 80, 0.62)',
    };
  }

  function renderCandleData(extraAnchorTimes = null) {
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
    (extraAnchorTimes || drawingAnchorTimes()).forEach(addWhitespace);
    const lastKnown = Number(state.candleData[state.candleData.length - 1]?.time || candles[candles.length - 1]?.time || 0);
    for (let index = 1; lastKnown && index <= FUTURE_WHITESPACE_BARS; index += 1) {
      addWhitespace(lastKnown + INTERVAL_SECONDS[state.interval] * index);
    }
    state.series.setData([...chartEntries.values()].sort((left, right) => Number(left.time) - Number(right.time)));
    state.volumeSeries?.setData(candles.map(toVolumePoint));
    updateCandleData(latestVisibleCandle());
    refreshVolumeProfiles();
  }

  function drawingAnchorTimesFromPayload(drawings) {
    const times = [];
    const firstCandleTime = Number(state.candleData[0]?.time || 0);
    const lastCandleTime = Number(state.candleData[state.candleData.length - 1]?.time || 0);
    const addUserAnchor = (time) => {
      const normalized = Number(time);
      if (!Number.isFinite(normalized) || normalized <= 0) return;
      if (firstCandleTime && lastCandleTime && normalized >= firstCandleTime && normalized <= lastCandleTime) return;
      times.push(normalized);
    };
    drawings.forEach((drawing) => {
      drawing.points?.forEach((point) => addUserAnchor(point.timestamp));
      drawing.anchors?.forEach((anchor) => addUserAnchor(anchor.time));
    });
    addUserAnchor(Math.floor(state.anchor / 1000));
    return times;
  }

  function latestVisibleCandle() {
    const visibleCount = state.mode === 'replay' ? state.replayVisibleCount : state.candleData.length;
    return visibleCount > 0 ? state.candleData[visibleCount - 1] : null;
  }

  function updateCandleData(candle) {
    if (!candle || !Number.isFinite(Number(candle.open))) {
      [elements.candleOpen, elements.candleHigh, elements.candleLow, elements.candleClose, elements.candleChange]
        .forEach((element) => { element.textContent = '--'; element.style.color = ''; });
      return;
    }
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const change = close - open;
    const changePercent = open ? change / open * 100 : 0;
    const color = change >= 0 ? '#089981' : '#f04452';
    const formatPrice = (value) => Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    elements.candleOpen.textContent = formatPrice(open);
    elements.candleHigh.textContent = formatPrice(high);
    elements.candleLow.textContent = formatPrice(low);
    elements.candleClose.textContent = formatPrice(close);
    elements.candleChange.textContent = `${change >= 0 ? '+' : ''}${formatPrice(change)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
    [elements.candleOpen, elements.candleHigh, elements.candleLow, elements.candleClose, elements.candleChange]
      .forEach((element) => { element.style.color = color; });
  }

  function setInitialVisibleRange() {
    const visibleCandles = state.mode === 'replay'
      ? state.candleData.slice(0, state.replayVisibleCount)
      : state.candleData;
    const firstCandle = visibleCandles[0];
    const lastCandle = visibleCandles[visibleCandles.length - 1];
    if (!firstCandle || !lastCandle) return;

    const timeScale = state.chart.timeScale();
    const firstIndex = timeScale.timeToIndex(firstCandle.time, true);
    const lastIndex = timeScale.timeToIndex(lastCandle.time, true);
    if (!Number.isFinite(firstIndex) || !Number.isFinite(lastIndex)) return;

    timeScale.setVisibleLogicalRange({
      from: Math.max(firstIndex, lastIndex - 159),
      to: lastIndex + VISIBLE_RIGHT_PADDING_BARS,
    });
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
            addUserAnchor(timestamp);
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
      if (state.replayOrigin === 'video' && state.video) {
        await reloadScope();
        focusReplayHotkeys();
        return;
      }
      if (state.replayDate) await beginReplay(state.replayDate, state.replayCursorTimestamp);
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
    state.replayOrigin = 'date';
    state.replayReady = false;
    state.replayStartIndex = 0;
    state.replayVisibleCount = 0;
    state.replayCursorTimestamp = 0;
    state.replayHasMore = false;
    state.loadingLater = false;
    state.candleData = [];
    state.video = null;
    state.anchor = 0;
    if (state.series) state.series.setData([]);
    state.volumeSeries?.setData([]);
    updateCandleData(null);
    if (state.lineTools) state.lineTools.removeAllLineTools();
    state.enhancedDrawings?.clearAll();
    state.drawingIds.clear();
    elements.startReplay.textContent = '开始复盘';
    elements.chartCutoff.textContent = '';
    setStatus('请选择日期，然后点击“开始复盘”。');
    updateReplayControls();
  }

  async function startReplayFromSelection() {
    if (state.replayOrigin === 'video' && state.video) {
      await beginVideoReplay(state.video);
      return;
    }
    const date = elements.replayDate.value;
    if (!date) {
      setStatus('请先选择复盘日期。', true);
      return;
    }
    await beginReplay(date);
  }

  async function beginReplay(date, preservedCursorTimestamp = 0) {
    stopReplayPlayback();
    state.replayOrigin = 'date';
    state.replayDate = date;
    state.replayReady = false;
    state.replayStartIndex = 0;
    state.replayVisibleCount = 0;
    state.anchor = Date.parse(`${date}T00:00:00+08:00`);
    if (!Number.isFinite(state.anchor)) {
      setStatus('复盘日期无效。', true);
      return;
    }
    state.replayCursorTimestamp = Number.isFinite(preservedCursorTimestamp) && preservedCursorTimestamp >= state.anchor
      ? preservedCursorTimestamp
      : state.anchor;
    state.replayHasMore = true;
    state.loadingLater = false;
    state.video = {
      '视频ID': `replay-${date}`,
      '视频标题': `${date} 行情复盘`,
      '发布日期': date,
      '发布时间（页面时区）': '00:00:00+08:00',
    };
    elements.reviewVideoTitle.textContent = `${date} 行情复盘`;
    elements.reviewVideoTime.textContent = '北京时间 00:00 起 · 未来行情逐根揭示 · 切换周期保持同一时刻';
    elements.startReplay.textContent = '重新开始';
    updateReplayControls();
    await reloadScope();
    focusReplayHotkeys();
  }

  async function beginVideoReplay(video, preservedCursorTimestamp = 0) {
    stopReplayPlayback();
    state.mode = 'replay';
    state.replayOrigin = 'video';
    state.video = video;
    state.anchor = videoTimestamp(video);
    state.replayDate = beijingDateString(new Date(state.anchor));
    state.replayReady = false;
    state.replayStartIndex = 0;
    state.replayVisibleCount = 0;
    state.replayCursorTimestamp = Number.isFinite(preservedCursorTimestamp)
      && preservedCursorTimestamp >= state.anchor
      ? preservedCursorTimestamp
      : state.anchor;
    state.replayHasMore = true;
    state.loadingLater = false;
    elements.replayDate.value = state.replayDate;
    elements.reviewVideoTitle.textContent = video['视频标题'];
    elements.reviewVideoTime.textContent = `视频发布：${formatTimestamp(state.anchor)} · 按 → 逐根揭示后续行情`;
    elements.startReplay.textContent = '重新开始';
    updateReplayControls();
    await reloadScope();
    focusReplayHotkeys();
  }

  function toggleReplayPlayback() {
    if (!state.replayReady) return;
    if (state.replayTimer) {
      stopReplayPlayback();
      setStatus('回放已暂停。');
      return;
    }
    if (state.replayVisibleCount >= state.candleData.length && !state.replayHasMore) {
      setStatus('已到达最新可用的已收盘 K 线。');
      return;
    }
    state.replayTimer = window.setInterval(() => void stepReplay(false), 1000 / state.replaySpeed);
    updateReplayControls();
    setStatus(`正在以 ${state.replaySpeed}× 速度回放…`);
    if (state.replayVisibleCount >= state.candleData.length) void stepReplay(false);
  }

  function stopReplayPlayback() {
    if (state.replayTimer) window.clearInterval(state.replayTimer);
    state.replayTimer = null;
    updateReplayControls();
  }

  async function stepReplay(pauseFirst) {
    if (!state.replayReady) return;
    if (pauseFirst) stopReplayPlayback();
    if (state.loadingLater) return;
    if (state.replayVisibleCount >= state.candleData.length) {
      if (state.replayHasMore) {
        try {
          await loadLaterReplayCandles();
          if (state.mode !== 'replay') return;
        } catch (error) {
          stopReplayPlayback();
          setStatus(error.message || '后续 K 线加载失败，可再次点击播放重试。', true);
          return;
        }
      }
      if (state.replayVisibleCount >= state.candleData.length) {
        stopReplayPlayback();
        setStatus('已到达最新可用的已收盘 K 线。');
        updateReplayControls();
        return;
      }
    }
    const visibleRange = state.chart.timeScale().getVisibleLogicalRange();
    const candleLogicalIndex = state.replayVisibleCount;
    const candle = state.candleData[state.replayVisibleCount];
    state.replayVisibleCount += 1;
    state.replayCursorTimestamp = (Number(candle.time) + INTERVAL_SECONDS[state.interval]) * 1000;
    // Hidden replay candles already exist as whitespace entries. Replacing just the
    // revealed entry avoids setData(), which resets the user's viewport on every step.
    state.series.update(candle, true);
    state.volumeSeries?.update(toVolumePoint(candle), true);
    updateCandleData(candle);
    refreshVolumeProfiles();
    void checkPaperTradesSettlement();
    followReplayCandle(visibleRange, candleLogicalIndex);
    updateReplayControls();
    if (state.replayVisibleCount >= state.candleData.length && !state.replayHasMore) {
      stopReplayPlayback();
      setStatus('已到达最新可用的已收盘 K 线。');
    } else if (pauseFirst) {
      setStatus('已前进一根 K 线。');
    }
  }

  async function loadLaterReplayCandles() {
    if (state.loadingLater || !state.replayHasMore || !state.candleData.length) return 0;
    state.loadingLater = true;
    state.laterAbortController?.abort();
    const abortController = new AbortController();
    state.laterAbortController = abortController;
    const reloadEpoch = state.reloadEpoch;
    updateReplayControls();
    const symbol = state.symbol;
    const interval = state.interval;
    const lastTimestamp = Number(state.candleData[state.candleData.length - 1].time) * 1000;
    const visibleRange = state.chart.timeScale().getVisibleLogicalRange();
    setStatus(`正在续载 ${INTERVAL_LABELS[interval]} K 线…`);
    try {
      const params = new URLSearchParams({
        symbol,
        interval,
        after: String(lastTimestamp),
        limit: '1000',
      });
      const payload = await fetch(`/api/chart/candles?${params}`, { signal: abortController.signal }).then(readJson);
      if (reloadEpoch !== state.reloadEpoch || symbol !== state.symbol || interval !== state.interval) return 0;
      if (symbol !== state.symbol || interval !== state.interval || state.mode !== 'replay') return 0;
      const knownTimes = new Set(state.candleData.map((candle) => Number(candle.time)));
      const later = (payload.candles || [])
        .map(toChartCandle)
        .filter((candle) => !knownTimes.has(Number(candle.time)))
        .sort((left, right) => Number(left.time) - Number(right.time));
      state.replayHasMore = payload.hasMore !== false;
      if (!later.length) {
        state.replayHasMore = false;
        if (payload.warning) setStatus(payload.warning, true);
        return 0;
      }
      state.candleData.push(...later);
      renderCandleData();
      if (visibleRange) state.chart.timeScale().setVisibleLogicalRange(visibleRange);
      elements.chartCutoff.textContent = `起点：${formatTimestamp(state.anchor)} · 已续载至 ${formatTimestamp((Number(later[later.length - 1].time) + INTERVAL_SECONDS[interval]) * 1000)}`;
      if (payload.warning) setStatus(payload.warning, true);
      return later.length;
    } catch (error) {
      if (error?.name === 'AbortError' || reloadEpoch !== state.reloadEpoch) return 0;
      throw error;
    } finally {
      if (reloadEpoch === state.reloadEpoch) {
        state.laterAbortController = null;
        state.loadingLater = false;
        updateReplayControls();
      }
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
    const canAdvance = remaining > 0 || state.replayHasMore;
    elements.toggleReplay.disabled = !state.replayReady || !canAdvance;
    elements.stepReplay.disabled = !state.replayReady || !canAdvance || state.loadingLater;
    elements.toggleReplay.textContent = state.replayTimer ? '❚❚ 暂停' : '▶ 播放';
    if (!state.replayReady) {
      elements.replayProgress.textContent = '请选择日期';
      return;
    }
    const currentTime = formatTimestamp(state.replayCursorTimestamp || state.anchor);
    const played = state.replayOrigin === 'video'
      ? Math.max(0, state.replayVisibleCount - state.replayStartIndex)
      : Math.max(0, Math.floor(((state.replayCursorTimestamp || state.anchor) - state.anchor) / (INTERVAL_SECONDS[state.interval] * 1000)));
    const bufferLabel = state.loadingLater ? '正在续载…' : `已缓冲 ${remaining} 根`;
    elements.replayProgress.textContent = `${currentTime} · 已播放约 ${played} 根 · ${bufferLabel}`;
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
    if (!Array.isArray(state.candleData) || state.candleData.length === 0) return;
    const targetSeconds = Math.floor(state.anchor / 1000);
    let closestCandle = state.candleData[0];
    let minDiff = Math.abs(Number(closestCandle.time) - targetSeconds);
    for (let i = 1; i < state.candleData.length; i++) {
      const diff = Math.abs(Number(state.candleData[i].time) - targetSeconds);
      if (diff < minDiff) {
        minDiff = diff;
        closestCandle = state.candleData[i];
      }
    }
    const markerTime = Number(closestCandle.time);
    const price = closestCandle.close;
    state.lineTools.createOrUpdateLineTool(
      'VerticalLine',
      [{ timestamp: markerTime, price }],
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
    updatePaperTradeButton();
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
    const date = new Date(timestamp);
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    const weekday = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
    }).format(date).replace(/^周/, '星期');
    return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute} ${weekday}`;
  }

  function formatChartTime(time) {
    if (typeof time === 'number') return formatTimestamp(time * 1000);
    if (time && typeof time === 'object') {
      const year = Number(time.year);
      const month = Number(time.month);
      const day = Number(time.day);
      if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
        return formatTimestamp(Date.parse(
          `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`,
        ));
      }
    }
    return '';
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

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function isTextInput(target) {
    return target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  function focusReplayHotkeys() {
    if (state.mode !== 'replay' || !state.replayReady || !elements.reviewDialog?.open) return;
    elements.reviewDialog.focus({ preventScroll: true });
  }

  // --- K 线选择定位：双击 K 线，切入该时间点，隐藏未来行情 ---
  function cutInAtCandle(clickedCandle) {
    if (!clickedCandle || !Number.isFinite(Number(clickedCandle.time))) return;
    const clickedTimestamp = Number(clickedCandle.time) * 1000;
    const cutTimestamp = clickedTimestamp + INTERVAL_SECONDS[state.interval] * 1000;
    stopReplayPlayback();
    state.mode = 'replay';
    state.replayReady = true;
    state.replayCursorTimestamp = cutTimestamp;
    const clickedIndex = state.candleData.findIndex((c) => Number(c.time) === Number(clickedCandle.time));
    if (clickedIndex < 0) return;
    state.replayVisibleCount = clickedIndex + 1;
    state.replayStartIndex = state.replayVisibleCount;
    state.replayHasMore = state.replayVisibleCount < state.candleData.length;
    if (!state.video) {
      const dateStr = beijingDateString(new Date(cutTimestamp));
      state.replayDate = dateStr;
      state.anchor = Date.parse(`${dateStr}T00:00:00+08:00`);
      state.video = {
        '视频ID': `cutin-${dateStr}`,
        '视频标题': `${dateStr} 行情复盘`,
        '发布日期': dateStr,
        '发布时间（页面时区）': '00:00:00+08:00',
      };
    } else {
      state.replayDate = state.video['发布日期'] || '';
    }
    renderCandleData();
    const timeScale = state.chart.timeScale();
    const clickedLogicalIndex = timeScale.timeToIndex(clickedCandle.time, true);
    if (Number.isFinite(clickedLogicalIndex)) {
      const visibleRange = timeScale.getVisibleLogicalRange();
      if (visibleRange) {
        const span = visibleRange.to - visibleRange.from;
        timeScale.setVisibleLogicalRange({
          from: clickedLogicalIndex - span + VISIBLE_RIGHT_PADDING_BARS,
          to: clickedLogicalIndex + VISIBLE_RIGHT_PADDING_BARS,
        });
      }
    }
    elements.replayControls.hidden = false;
    elements.reviewVideoTitle.textContent = `K线定位复盘 · 已切入 ${formatTimestamp(clickedTimestamp)}`;
    elements.reviewVideoTime.textContent = '已隐藏未来行情 · 按→键逐根揭示 · 按←键回退';
    elements.startReplay.textContent = '重新开始';
    updateReplayControls();
    focusReplayHotkeys();
    setStatus(`已定位至 ${formatTimestamp(clickedTimestamp)}，后续 ${state.candleData.length - state.replayVisibleCount} 根 K 线已隐藏。`);
  }

  // --- 回放回退一根 K 线 ---
  function stepReplayBackward() {
    if (!state.replayReady || state.replayVisibleCount <= 1) return;
    stopReplayPlayback();
    state.replayVisibleCount -= 1;
    const hiddenCandle = state.candleData[state.replayVisibleCount];
    const lastVisible = state.candleData[state.replayVisibleCount - 1];
    state.replayCursorTimestamp = state.replayVisibleCount === state.replayStartIndex
      ? state.anchor
      : lastVisible
        ? (Number(lastVisible.time) + INTERVAL_SECONDS[state.interval]) * 1000
        : state.anchor;
    // Replace only the removed candle with whitespace so the viewport does not
    // jump back to the default range on every rewind step.
    if (hiddenCandle) state.series.update({ time: hiddenCandle.time }, true);
    if (hiddenCandle) state.volumeSeries?.update({ time: hiddenCandle.time }, true);
    updateCandleData(latestVisibleCandle());
    refreshVolumeProfiles();
    updateReplayControls();
  }

  // --- 全局长按左右键播放与倒播控制 ---
  let globalHoldDelayTimer = null;
  let globalHoldRepeatTimer = null;
  let globalHoldDirection = null;
  let globalHoldRepeated = false;

  function stepGlobalHold(direction) {
    if (state.mode !== 'replay' || !state.replayReady) return;
    if (direction === 'forward') {
      void stepReplay(false);
    } else {
      stepReplayBackward();
    }
  }

  function startGlobalHold(direction) {
    if (globalHoldDirection === direction) return;
    stopGlobalHold();
    globalHoldDirection = direction;
    globalHoldRepeated = false;
    globalHoldDelayTimer = window.setTimeout(() => {
      if (globalHoldDirection !== direction) return;
      globalHoldRepeated = true;
      stepGlobalHold(direction);
      globalHoldRepeatTimer = window.setInterval(() => stepGlobalHold(direction), 100);
    }, 200);
  }

  function stopGlobalHold(stepOnShortPress = false) {
    const direction = globalHoldDirection;
    const shouldStep = stepOnShortPress && direction && !globalHoldRepeated;
    if (globalHoldDelayTimer) window.clearTimeout(globalHoldDelayTimer);
    if (globalHoldRepeatTimer) window.clearInterval(globalHoldRepeatTimer);
    globalHoldDelayTimer = null;
    globalHoldRepeatTimer = null;
    globalHoldDirection = null;
    globalHoldRepeated = false;
    if (shouldStep) stepGlobalHold(direction);
  }

  window.addEventListener('keydown', (e) => {
    if (isTextInput(e.target)) return;
    if (e.key === 'ArrowRight' && state.mode === 'replay' && state.replayReady) {
      e.preventDefault();
      startGlobalHold('forward');
    } else if (e.key === 'ArrowLeft' && state.mode === 'replay' && state.replayReady) {
      e.preventDefault();
      startGlobalHold('rewind');
    }
  });

  window.addEventListener('keyup', (e) => {
    const direction = e.key === 'ArrowRight' ? 'forward' : e.key === 'ArrowLeft' ? 'rewind' : null;
    if (direction && globalHoldDirection === direction) stopGlobalHold(true);
  });

  window.addEventListener('blur', stopGlobalHold);

  window.TiaReviewChart = { init, open, openReplay, close, cutInAtCandle };
}());
