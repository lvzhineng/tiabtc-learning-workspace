import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  clearAllDrawingsForSymbol,
  deleteDrawing,
  fetchDrawings,
  replaceDrawings,
  saveDrawing,
} from '@/api/drawing-api';
import {
  deleteBitlangDrawing,
  fetchBitlangDrawings,
  replaceBitlangDrawings,
  saveBitlangDrawing,
  type BitlangDrawingScope,
} from '@/api/bitlang-review-api';
import {
  deletePositionDrawing,
  fetchPositionDrawings,
  replacePositionDrawings,
  savePositionDrawing,
  type PositionDrawingScope,
} from '@/api/position-review-api';
import type { ReviewTimeframe } from '@/domain/timeframe';
import {
  deserializeDrawing,
  serializeDrawing,
} from '@/features/drawings/drawing-engine';
import type {
  ActiveToolType,
  DrawingToolState,
} from '@/features/drawings/drawing-types';
import { confirmDialog } from '@/ui/feedback/confirm';
import { toast } from '@/ui/feedback/toast';
import {
  readLocalUiState,
  storedBoolean,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';

type DrawingWorkspace = {
  ready: boolean;
  activeTool: ActiveToolType;
  setActiveTool: Dispatch<SetStateAction<ActiveToolType>>;
  magnetEnabled: boolean;
  toggleMagnet: () => void;
  drawings: DrawingToolState[];
  allDrawings: DrawingToolState[];
  selectedDrawingId: string | null;
  setSelectedDrawingId: Dispatch<SetStateAction<string | null>>;
  hiddenDrawingIds: Set<string>;
  hideAllDrawings: boolean;
  toggleHideAllDrawings: () => void;
  toggleHideDrawing: (id: string) => void;
  isObjectTreeOpen: boolean;
  toggleObjectTree: () => void;
  saveDrawingState: (drawing: DrawingToolState) => Promise<void>;
  deleteSelectedDrawing: () => Promise<void>;
  deleteDrawingById: (id: string) => Promise<void>;
  clearAllDrawings: () => Promise<void>;
  toggleLockSelected: () => Promise<void>;
  toggleLockDrawing: (id: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

const DRAWING_SCOPE = '__global__';
const DRAWING_UI_STORAGE_KEY = 'tiabtc-drawing-ui-v1';
const MAX_HISTORY_ENTRIES = 100;
type DrawingPersistence = 'server' | 'memory' | 'position' | 'bitlang';
type ExtraDrawingScope = PositionDrawingScope | BitlangDrawingScope;

export function useDrawingWorkspace(
  symbol: string,
  timeframe: ReviewTimeframe,
  persistence: DrawingPersistence = 'server',
  extraScope?: ExtraDrawingScope
): DrawingWorkspace {
  const positionVenue =
    extraScope && 'venue' in extraScope ? extraScope.venue : '';
  const positionId =
    extraScope && 'positionId' in extraScope ? extraScope.positionId : '';
  const bitlangTradeId =
    extraScope && 'tradeId' in extraScope ? extraScope.tradeId : '';
  const drawingWorkspaceKey =
    persistence === 'memory'
      ? `${persistence}:${symbol}:${timeframe}`
      : persistence === 'position'
        ? `${persistence}:${positionVenue}:${positionId}:${symbol}`
        : persistence === 'bitlang'
          ? `${persistence}:${bitlangTradeId}:${symbol}`
          : `${persistence}:${symbol}`;
  const [activeTool, setActiveTool] = useState<ActiveToolType>('select');
  const [magnetEnabled, setMagnetEnabled] = useState(() =>
    storedBoolean(
      readLocalUiState(DRAWING_UI_STORAGE_KEY).magnetEnabled,
      false
    )
  );
  const [drawings, setDrawings] = useState<DrawingToolState[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(
    null
  );
  const [hiddenDrawingIds, setHiddenDrawingIds] = useState<Set<string>>(
    () => new Set()
  );
  const [hideAllDrawings, setHideAllDrawings] = useState(false);
  const [isObjectTreeOpen, setIsObjectTreeOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<DrawingToolState[][]>([]);
  const [redoStack, setRedoStack] = useState<DrawingToolState[][]>([]);
  const [hydratedWorkspaceKey, setHydratedWorkspaceKey] = useState('');
  const ready = hydratedWorkspaceKey === drawingWorkspaceKey;

  useEffect(() => {
    writeLocalUiState(DRAWING_UI_STORAGE_KEY, { magnetEnabled });
  }, [magnetEnabled]);

  const drawingsRef = useRef<DrawingToolState[]>([]);
  const confirmedDrawingsRef = useRef<DrawingToolState[]>([]);
  const saveChainsRef = useRef<Record<string, Promise<void>>>({});
  const saveRevisionsRef = useRef<Record<string, number>>({});
  const workspaceRevisionRef = useRef(0);
  const historyOperationRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const loadScopeRef = useRef({
    symbol,
    timeframe,
    positionVenue,
    positionId,
    bitlangTradeId,
  });
  loadScopeRef.current = {
    symbol,
    timeframe,
    positionVenue,
    positionId,
    bitlangTradeId,
  };

  const replaceLocalDrawings = useCallback(
    (nextDrawings: DrawingToolState[]) => {
      drawingsRef.current = nextDrawings;
      setDrawings(nextDrawings);
    },
    []
  );

  const commitLocalChange = useCallback(
    (
      nextDrawings: DrawingToolState[],
      previousDrawings = drawingsRef.current
    ) => {
      setUndoStack((stack) =>
        [...stack, previousDrawings].slice(-MAX_HISTORY_ENTRIES)
      );
      setRedoStack([]);
      replaceLocalDrawings(nextDrawings);
    },
    [replaceLocalDrawings]
  );

  useEffect(() => {
    const loadScope = loadScopeRef.current;
    const workspaceRevision = ++workspaceRevisionRef.current;
    const controller = new AbortController();
    setHydratedWorkspaceKey('');
    replaceLocalDrawings([]);
    setSelectedDrawingId(null);
    setUndoStack([]);
    setRedoStack([]);
    saveChainsRef.current = {};
    saveRevisionsRef.current = {};
    confirmedDrawingsRef.current = [];
    historyOperationRef.current = false;
    if (persistence === 'memory') {
      setHydratedWorkspaceKey(drawingWorkspaceKey);
      return () => {
        if (workspaceRevisionRef.current === workspaceRevision) {
          workspaceRevisionRef.current += 1;
        }
      };
    }
    const request =
      persistence === 'position'
        ? fetchPositionDrawings(
            {
              venue: loadScope.positionVenue,
              positionId: loadScope.positionId,
            },
            loadScope.symbol,
            loadScope.timeframe,
            controller.signal
          )
        : persistence === 'bitlang'
          ? fetchBitlangDrawings(
              { tradeId: loadScope.bitlangTradeId },
              loadScope.symbol,
              loadScope.timeframe,
              controller.signal
            )
          : fetchDrawings(
              DRAWING_SCOPE,
              loadScope.symbol,
              loadScope.timeframe,
              controller.signal
            );
    void request
      .then((persistedDrawings) => {
        if (
          controller.signal.aborted ||
          workspaceRevisionRef.current !== workspaceRevision
        ) {
          return;
        }
        const loadedDrawings = persistedDrawings.map(deserializeDrawing);
        confirmedDrawingsRef.current = loadedDrawings;
        replaceLocalDrawings(loadedDrawings);
        setHydratedWorkspaceKey(drawingWorkspaceKey);
      })
      .catch((requestError) => {
        if (
          !controller.signal.aborted &&
          workspaceRevisionRef.current === workspaceRevision
        ) {
          console.warn('拉取画图持久化记录失败:', requestError);
          toast.error('加载画图失败，已暂停画图编辑；请刷新页面后重试');
        }
      });
    return () => {
      controller.abort();
      if (workspaceRevisionRef.current === workspaceRevision) {
        workspaceRevisionRef.current += 1;
      }
    };
  }, [drawingWorkspaceKey, persistence, replaceLocalDrawings]);

  const saveDrawingState = useCallback(
    async (toolState: DrawingToolState) => {
      if (!readyRef.current) return;
      const workspaceRevision = workspaceRevisionRef.current;
      const drawingSaveRevision =
        (saveRevisionsRef.current[toolState.id] || 0) + 1;
      saveRevisionsRef.current[toolState.id] = drawingSaveRevision;
      const previousDrawings = drawingsRef.current;
      const previousDrawing = previousDrawings.find(
        (drawing) => drawing.id === toolState.id
      );
      const exists = Boolean(previousDrawing);
      const optimisticDrawings = exists
        ? previousDrawings.map((drawing) =>
            drawing.id === toolState.id ? toolState : drawing
          )
        : [...previousDrawings, toolState];
      commitLocalChange(optimisticDrawings, previousDrawings);
      if (persistence === 'memory') return;

      const previousSave =
        saveChainsRef.current[toolState.id] || Promise.resolve();
      const currentSave = previousSave
        .catch(() => undefined)
        .then(async () => {
          const serialized = serializeDrawing(toolState);
          const saved =
            persistence === 'position'
              ? await savePositionDrawing(
                  { venue: positionVenue, positionId },
                  serialized
                )
              : persistence === 'bitlang'
                ? await saveBitlangDrawing(
                    { tradeId: bitlangTradeId },
                    serialized
                  )
                : await saveDrawing(serialized);
          if (workspaceRevisionRef.current !== workspaceRevision) {
            return;
          }
          const normalized = deserializeDrawing(saved);
          const confirmed = confirmedDrawingsRef.current;
          confirmedDrawingsRef.current = confirmed.some(
            (drawing) => drawing.id === toolState.id
          )
            ? confirmed.map((drawing) =>
                drawing.id === toolState.id ? normalized : drawing
              )
            : [...confirmed, normalized];
          if (
            saveRevisionsRef.current[toolState.id] !== drawingSaveRevision
          ) {
            return;
          }
          const current = drawingsRef.current;
          replaceLocalDrawings(
            current.map((drawing) =>
              drawing.id === toolState.id ? normalized : drawing
            )
          );
        });
      saveChainsRef.current[toolState.id] = currentSave;
      try {
        await currentSave;
      } catch (saveError) {
        if (
          workspaceRevisionRef.current === workspaceRevision &&
          saveRevisionsRef.current[toolState.id] === drawingSaveRevision
        ) {
          const current = drawingsRef.current;
          const confirmedDrawing = confirmedDrawingsRef.current.find(
            (drawing) => drawing.id === toolState.id
          );
          replaceLocalDrawings(
            confirmedDrawing
              ? current.map((drawing) =>
                  drawing.id === toolState.id ? confirmedDrawing : drawing
                )
              : current.filter((drawing) => drawing.id !== toolState.id)
          );
          setUndoStack([]);
          setRedoStack([]);
        }
        toast.error(
          `保存画图记录失败: ${
            saveError instanceof Error
              ? saveError.message
              : '网络或数据库异常'
          }`
        );
      } finally {
        if (saveChainsRef.current[toolState.id] === currentSave) {
          delete saveChainsRef.current[toolState.id];
        }
      }
    },
    [
      bitlangTradeId,
      commitLocalChange,
      persistence,
      positionId,
      positionVenue,
      replaceLocalDrawings,
    ]
  );

  const deleteSelectedDrawing = useCallback(async () => {
    if (!readyRef.current) return;
    if (!selectedDrawingId) return;
    const target = drawingsRef.current.find(
      (drawing) => drawing.id === selectedDrawingId
    );
    if (!target) return;
    const workspaceRevision = workspaceRevisionRef.current;
    const confirmed = await confirmDialog({
      title: '删除画图',
      message: '确认删除当前选中的画图吗？',
      confirmText: '确认删除',
      isDanger: true,
    });
    if (!confirmed || workspaceRevisionRef.current !== workspaceRevision) return;

    if (persistence === 'memory') {
      const current = drawingsRef.current;
      commitLocalChange(
        current.filter((drawing) => drawing.id !== selectedDrawingId),
        current
      );
      setSelectedDrawingId(null);
      return;
    }

    try {
      await saveChainsRef.current[selectedDrawingId]?.catch(() => undefined);
      if (persistence === 'position') {
        await deletePositionDrawing(
          { venue: positionVenue, positionId },
          symbol,
          timeframe,
          selectedDrawingId
        );
      } else if (persistence === 'bitlang') {
        await deleteBitlangDrawing(
          { tradeId: bitlangTradeId },
          symbol,
          timeframe,
          selectedDrawingId
        );
      } else {
        await deleteDrawing(
          selectedDrawingId,
          DRAWING_SCOPE,
          symbol,
          timeframe
        );
      }
      if (workspaceRevisionRef.current !== workspaceRevision) return;
      confirmedDrawingsRef.current = confirmedDrawingsRef.current.filter(
        (drawing) => drawing.id !== selectedDrawingId
      );
      const current = drawingsRef.current;
      commitLocalChange(
        current.filter((drawing) => drawing.id !== selectedDrawingId),
        current
      );
      setSelectedDrawingId(null);
      toast.success('已删除画图');
    } catch (deleteError) {
      toast.error(
        `删除画图记录失败: ${
          deleteError instanceof Error ? deleteError.message : '网络异常'
        }`
      );
    }
  }, [
    bitlangTradeId,
    commitLocalChange,
    persistence,
    positionId,
    positionVenue,
    selectedDrawingId,
    symbol,
    timeframe,
  ]);

  const clearAllDrawings = useCallback(async () => {
    if (!readyRef.current) return;
    const current = drawingsRef.current;
    if (current.length === 0) return;
    const workspaceRevision = workspaceRevisionRef.current;
    const confirmed = await confirmDialog({
      title: '清空画图',
      message:
        persistence === 'memory'
          ? `确认要清空当前 Symbol (${symbol}) 的所有临时画图吗？`
          : persistence === 'position'
            ? `确认要清空当前仓位 (${symbol}) 的所有画图记录吗？此操作无法撤销。`
            : persistence === 'bitlang'
              ? `确认要清空当前交易 (${symbol}) 的所有画图记录吗？此操作无法撤销。`
              : `确认要清空当前 Symbol (${symbol}) 的所有画图记录吗？此操作无法撤销。`,
      confirmText: '确认清空',
      isDanger: true,
    });
    if (!confirmed || workspaceRevisionRef.current !== workspaceRevision) return;

    if (persistence === 'memory') {
      commitLocalChange([], current);
      setSelectedDrawingId(null);
      toast.success('已清空临时画图');
      return;
    }

    try {
      await Promise.all(
        Object.values(saveChainsRef.current).map((request) =>
          request.catch(() => undefined)
        )
      );
      if (persistence === 'position') {
        await deletePositionDrawing(
          { venue: positionVenue, positionId },
          symbol,
          timeframe
        );
      } else if (persistence === 'bitlang') {
        await deleteBitlangDrawing(
          { tradeId: bitlangTradeId },
          symbol,
          timeframe
        );
      } else {
        await clearAllDrawingsForSymbol(DRAWING_SCOPE, symbol, timeframe);
      }
      if (workspaceRevisionRef.current !== workspaceRevision) return;
      confirmedDrawingsRef.current = [];
      commitLocalChange([], drawingsRef.current);
      setSelectedDrawingId(null);
      toast.success('已清空所有画图记录');
    } catch (clearError) {
      toast.error(
        `清空画图失败: ${
          clearError instanceof Error ? clearError.message : '网络异常'
        }`
      );
    }
  }, [
    bitlangTradeId,
    commitLocalChange,
    persistence,
    positionId,
    positionVenue,
    symbol,
    timeframe,
  ]);

  const deleteDrawingById = useCallback(
    async (targetId: string) => {
      if (!readyRef.current) return;
      const target = drawingsRef.current.find(
        (drawing) => drawing.id === targetId
      );
      if (!target) return;
      const workspaceRevision = workspaceRevisionRef.current;
      const confirmed = await confirmDialog({
        title: '删除画图',
        message: '确认删除此画图吗？',
        confirmText: '确认删除',
        isDanger: true,
      });
      if (!confirmed || workspaceRevisionRef.current !== workspaceRevision) return;

      if (persistence === 'memory') {
        const current = drawingsRef.current;
        commitLocalChange(
          current.filter((drawing) => drawing.id !== targetId),
          current
        );
        if (selectedDrawingId === targetId) setSelectedDrawingId(null);
        toast.success('已删除画图');
        return;
      }

      try {
        await saveChainsRef.current[targetId]?.catch(() => undefined);
        if (persistence === 'position') {
          await deletePositionDrawing(
            { venue: positionVenue, positionId },
            symbol,
            timeframe,
            targetId
          );
        } else if (persistence === 'bitlang') {
          await deleteBitlangDrawing(
            { tradeId: bitlangTradeId },
            symbol,
            timeframe,
            targetId
          );
        } else {
          await deleteDrawing(
            targetId,
            DRAWING_SCOPE,
            symbol,
            timeframe
          );
        }
        if (workspaceRevisionRef.current !== workspaceRevision) return;
        confirmedDrawingsRef.current = confirmedDrawingsRef.current.filter(
          (drawing) => drawing.id !== targetId
        );
        const current = drawingsRef.current;
        commitLocalChange(
          current.filter((drawing) => drawing.id !== targetId),
          current
        );
        if (selectedDrawingId === targetId) setSelectedDrawingId(null);
        toast.success('已删除画图');
      } catch (deleteError) {
        toast.error(
          `删除画图记录失败: ${
            deleteError instanceof Error ? deleteError.message : '网络异常'
          }`
        );
      }
    },
    [
      bitlangTradeId,
      commitLocalChange,
      persistence,
      positionId,
      positionVenue,
      selectedDrawingId,
      symbol,
      timeframe,
    ]
  );

  const toggleLockDrawing = useCallback(
    async (targetId: string) => {
      const target = drawingsRef.current.find(
        (drawing) => drawing.id === targetId
      );
      if (target) {
        await saveDrawingState({ ...target, locked: !target.locked });
      }
    },
    [saveDrawingState]
  );

  const toggleLockSelected = useCallback(async () => {
    if (!selectedDrawingId) return;
    await toggleLockDrawing(selectedDrawingId);
  }, [selectedDrawingId, toggleLockDrawing]);

  const toggleHideAllDrawings = useCallback(() => {
    setHideAllDrawings((hidden) => !hidden);
  }, []);

  const toggleHideDrawing = useCallback((id: string) => {
    setHiddenDrawingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleObjectTree = useCallback(() => {
    setIsObjectTreeOpen((open) => !open);
  }, []);

  const toggleMagnet = useCallback(() => {
    setMagnetEnabled((enabled) => !enabled);
  }, []);

  const scopedDrawings = useMemo(
    () => drawings.filter((drawing) => drawing.symbol === symbol),
    [drawings, symbol]
  );

  const visibleDrawings = useMemo(() => {
    if (hideAllDrawings) return [];
    if (hiddenDrawingIds.size === 0) return scopedDrawings;
    return scopedDrawings.filter((drawing) => !hiddenDrawingIds.has(drawing.id));
  }, [hideAllDrawings, hiddenDrawingIds, scopedDrawings]);

  const waitForPendingSaves = useCallback(async () => {
    await Promise.all(
      Object.values(saveChainsRef.current).map((request) =>
        request.catch(() => undefined)
      )
    );
  }, []);

  const reconcileSelection = useCallback(
    (nextDrawings: DrawingToolState[]) => {
      setSelectedDrawingId((currentId) =>
        currentId && nextDrawings.some((drawing) => drawing.id === currentId)
          ? currentId
          : null
      );
    },
    []
  );

  const undo = useCallback(async () => {
    if (
      !readyRef.current ||
      undoStack.length === 0 ||
      historyOperationRef.current
    ) {
      return;
    }
    const workspaceRevision = workspaceRevisionRef.current;
    historyOperationRef.current = true;
    const previous = undoStack[undoStack.length - 1];
    const current = drawingsRef.current;
    try {
      if (persistence === 'memory') {
        setRedoStack((stack) =>
          [...stack, current].slice(-MAX_HISTORY_ENTRIES)
        );
        setUndoStack((stack) => stack.slice(0, -1));
        replaceLocalDrawings(previous);
        reconcileSelection(previous);
        return;
      }
      await waitForPendingSaves();
      if (workspaceRevisionRef.current !== workspaceRevision) return;
      const serialized = previous.map(serializeDrawing);
      const saved =
        persistence === 'position'
          ? await replacePositionDrawings(
              { venue: positionVenue, positionId },
              symbol,
              timeframe,
              serialized
            )
          : persistence === 'bitlang'
            ? await replaceBitlangDrawings(
                { tradeId: bitlangTradeId },
                symbol,
                timeframe,
                serialized
              )
            : await replaceDrawings(
                DRAWING_SCOPE,
                symbol,
                timeframe,
                serialized
              );
      if (workspaceRevisionRef.current !== workspaceRevision) return;
      setRedoStack((stack) =>
        [...stack, current].slice(-MAX_HISTORY_ENTRIES)
      );
      setUndoStack((stack) => stack.slice(0, -1));
      const restored = saved.map(deserializeDrawing);
      confirmedDrawingsRef.current = restored;
      replaceLocalDrawings(restored);
      reconcileSelection(restored);
    } catch (undoError) {
      if (workspaceRevisionRef.current === workspaceRevision) {
        toast.error(
          `撤销画图失败: ${
            undoError instanceof Error ? undoError.message : '网络异常'
          }`
        );
      }
    } finally {
      if (workspaceRevisionRef.current === workspaceRevision) {
        historyOperationRef.current = false;
      }
    }
  }, [
    bitlangTradeId,
    persistence,
    positionId,
    positionVenue,
    reconcileSelection,
    replaceLocalDrawings,
    symbol,
    timeframe,
    undoStack,
    waitForPendingSaves,
  ]);

  const redo = useCallback(async () => {
    if (
      !readyRef.current ||
      redoStack.length === 0 ||
      historyOperationRef.current
    ) {
      return;
    }
    const workspaceRevision = workspaceRevisionRef.current;
    historyOperationRef.current = true;
    const next = redoStack[redoStack.length - 1];
    const current = drawingsRef.current;
    try {
      if (persistence === 'memory') {
        setUndoStack((stack) =>
          [...stack, current].slice(-MAX_HISTORY_ENTRIES)
        );
        setRedoStack((stack) => stack.slice(0, -1));
        replaceLocalDrawings(next);
        reconcileSelection(next);
        return;
      }
      await waitForPendingSaves();
      if (workspaceRevisionRef.current !== workspaceRevision) return;
      const serialized = next.map(serializeDrawing);
      const saved =
        persistence === 'position'
          ? await replacePositionDrawings(
              { venue: positionVenue, positionId },
              symbol,
              timeframe,
              serialized
            )
          : persistence === 'bitlang'
            ? await replaceBitlangDrawings(
                { tradeId: bitlangTradeId },
                symbol,
                timeframe,
                serialized
              )
            : await replaceDrawings(
                DRAWING_SCOPE,
                symbol,
                timeframe,
                serialized
              );
      if (workspaceRevisionRef.current !== workspaceRevision) return;
      setUndoStack((stack) =>
        [...stack, current].slice(-MAX_HISTORY_ENTRIES)
      );
      setRedoStack((stack) => stack.slice(0, -1));
      const restored = saved.map(deserializeDrawing);
      confirmedDrawingsRef.current = restored;
      replaceLocalDrawings(restored);
      reconcileSelection(restored);
    } catch (redoError) {
      if (workspaceRevisionRef.current === workspaceRevision) {
        toast.error(
          `重做画图失败: ${
            redoError instanceof Error ? redoError.message : '网络异常'
          }`
        );
      }
    } finally {
      if (workspaceRevisionRef.current === workspaceRevision) {
        historyOperationRef.current = false;
      }
    }
  }, [
    bitlangTradeId,
    persistence,
    positionId,
    positionVenue,
    reconcileSelection,
    redoStack,
    replaceLocalDrawings,
    symbol,
    timeframe,
    waitForPendingSaves,
  ]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!readyRef.current) return;
      if (
        event.defaultPrevented ||
        document.querySelector('[aria-modal="true"]')
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        setActiveTool('select');
        setSelectedDrawingId(null);
        return;
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedDrawingId
      ) {
        event.preventDefault();
        void deleteSelectedDrawing();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'y'
      ) {
        event.preventDefault();
        void redo();
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.code === 'KeyT') {
          event.preventDefault();
          setActiveTool('TrendLine');
        } else if (event.code === 'KeyJ') {
          event.preventDefault();
          setActiveTool('HorizontalRay');
        } else if (event.code === 'KeyH') {
          event.preventDefault();
          setActiveTool('HorizontalLine');
        } else if (event.code === 'KeyF') {
          event.preventDefault();
          setActiveTool('FibRetracement');
        } else if (event.code === 'KeyR') {
          event.preventDefault();
          setActiveTool('Rectangle');
        } else if (event.code === 'KeyV') {
          event.preventDefault();
          toggleHideAllDrawings();
        }
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [
    deleteSelectedDrawing,
    redo,
    selectedDrawingId,
    toggleHideAllDrawings,
    undo,
  ]);

  return {
    ready,
    activeTool,
    setActiveTool,
    magnetEnabled,
    toggleMagnet,
    drawings: visibleDrawings,
    allDrawings: scopedDrawings,
    selectedDrawingId,
    setSelectedDrawingId,
    hiddenDrawingIds,
    hideAllDrawings,
    toggleHideAllDrawings,
    toggleHideDrawing,
    isObjectTreeOpen,
    toggleObjectTree,
    saveDrawingState,
    deleteSelectedDrawing,
    deleteDrawingById,
    clearAllDrawings,
    toggleLockSelected,
    toggleLockDrawing,
    undo,
    redo,
  };
}
