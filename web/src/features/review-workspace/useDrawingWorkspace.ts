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
import type { ReviewTimeframe } from '@/domain/timeframe';
import {
  deserializeDrawing,
  serializeDrawing,
} from '@/features/drawings/drawing-engine';
import type {
  ActiveToolType,
  DrawingToolState,
} from '@/features/drawings/drawing-types';

type DrawingWorkspace = {
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
const MAX_HISTORY_ENTRIES = 100;
type DrawingPersistence = 'server' | 'memory';

export function useDrawingWorkspace(
  symbol: string,
  timeframe: ReviewTimeframe,
  persistence: DrawingPersistence = 'server'
): DrawingWorkspace {
  const [activeTool, setActiveTool] = useState<ActiveToolType>('select');
  const [magnetEnabled, setMagnetEnabled] = useState(false);
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

  const drawingsRef = useRef<DrawingToolState[]>([]);
  const saveChainsRef = useRef<Record<string, Promise<void>>>({});
  const saveRevisionsRef = useRef<Record<string, number>>({});
  const workspaceRevisionRef = useRef(0);
  const historyOperationRef = useRef(false);
  const loadScopeRef = useRef({ symbol, timeframe });
  loadScopeRef.current = { symbol, timeframe };
  const drawingWorkspaceKey =
    persistence === 'memory'
      ? `${persistence}:${symbol}:${timeframe}`
      : `${persistence}:${symbol}`;

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
    replaceLocalDrawings([]);
    setSelectedDrawingId(null);
    setUndoStack([]);
    setRedoStack([]);
    saveChainsRef.current = {};
    saveRevisionsRef.current = {};
    if (persistence === 'memory') {
      return () => {
        if (workspaceRevisionRef.current === workspaceRevision) {
          workspaceRevisionRef.current += 1;
        }
      };
    }
    void fetchDrawings(
      DRAWING_SCOPE,
      loadScope.symbol,
      loadScope.timeframe,
      controller.signal
    )
      .then((persistedDrawings) => {
        if (
          controller.signal.aborted ||
          workspaceRevisionRef.current !== workspaceRevision
        ) {
          return;
        }
        replaceLocalDrawings(persistedDrawings.map(deserializeDrawing));
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          console.warn('拉取画图持久化记录失败:', requestError);
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
          const saved = await saveDrawing(serializeDrawing(toolState));
          if (
            workspaceRevisionRef.current !== workspaceRevision ||
            saveRevisionsRef.current[toolState.id] !== drawingSaveRevision
          ) {
            return;
          }
          const normalized = deserializeDrawing(saved);
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
          replaceLocalDrawings(
            previousDrawing
              ? current.map((drawing) =>
                  drawing.id === toolState.id ? previousDrawing : drawing
                )
              : current.filter((drawing) => drawing.id !== toolState.id)
          );
        }
        alert(
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
    [commitLocalChange, persistence, replaceLocalDrawings]
  );

  const deleteSelectedDrawing = useCallback(async () => {
    if (!selectedDrawingId) return;
    const target = drawingsRef.current.find(
      (drawing) => drawing.id === selectedDrawingId
    );
    if (!target || !window.confirm('确认删除当前选中的画图吗？')) return;

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
      await deleteDrawing(
        selectedDrawingId,
        DRAWING_SCOPE,
        symbol,
        timeframe
      );
      const current = drawingsRef.current;
      commitLocalChange(
        current.filter((drawing) => drawing.id !== selectedDrawingId),
        current
      );
      setSelectedDrawingId(null);
    } catch (deleteError) {
      alert(
        `删除画图记录失败: ${
          deleteError instanceof Error ? deleteError.message : '网络异常'
        }`
      );
    }
  }, [
    commitLocalChange,
    persistence,
    selectedDrawingId,
    symbol,
    timeframe,
  ]);

  const clearAllDrawings = useCallback(async () => {
    const current = drawingsRef.current;
    if (
      current.length === 0 ||
      !window.confirm(
        persistence === 'memory'
          ? `确认要清空当前 Symbol (${symbol}) 的所有临时画图吗？`
          : `确认要清空当前 Symbol (${symbol}) 的所有画图记录吗？此操作无法撤销。`
      )
    ) {
      return;
    }

    if (persistence === 'memory') {
      commitLocalChange([], current);
      setSelectedDrawingId(null);
      return;
    }

    try {
      await Promise.all(
        Object.values(saveChainsRef.current).map((request) =>
          request.catch(() => undefined)
        )
      );
      await clearAllDrawingsForSymbol(DRAWING_SCOPE, symbol, timeframe);
      commitLocalChange([], drawingsRef.current);
      setSelectedDrawingId(null);
    } catch (clearError) {
      alert(
        `清空画图失败: ${
          clearError instanceof Error ? clearError.message : '网络异常'
        }`
      );
    }
  }, [commitLocalChange, persistence, symbol, timeframe]);

  const deleteDrawingById = useCallback(
    async (targetId: string) => {
      const target = drawingsRef.current.find(
        (drawing) => drawing.id === targetId
      );
      if (!target || !window.confirm('确认删除此画图吗？')) return;

      if (persistence === 'memory') {
        const current = drawingsRef.current;
        commitLocalChange(
          current.filter((drawing) => drawing.id !== targetId),
          current
        );
        if (selectedDrawingId === targetId) setSelectedDrawingId(null);
        return;
      }

      try {
        await saveChainsRef.current[targetId]?.catch(() => undefined);
        await deleteDrawing(
          targetId,
          DRAWING_SCOPE,
          symbol,
          timeframe
        );
        const current = drawingsRef.current;
        commitLocalChange(
          current.filter((drawing) => drawing.id !== targetId),
          current
        );
        if (selectedDrawingId === targetId) setSelectedDrawingId(null);
      } catch (deleteError) {
        alert(
          `删除画图记录失败: ${
            deleteError instanceof Error ? deleteError.message : '网络异常'
          }`
        );
      }
    },
    [commitLocalChange, persistence, selectedDrawingId, symbol, timeframe]
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
    if (undoStack.length === 0 || historyOperationRef.current) return;
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
      const saved = await replaceDrawings(
        DRAWING_SCOPE,
        symbol,
        timeframe,
        previous.map(serializeDrawing)
      );
      setRedoStack((stack) =>
        [...stack, current].slice(-MAX_HISTORY_ENTRIES)
      );
      setUndoStack((stack) => stack.slice(0, -1));
      const restored = saved.map(deserializeDrawing);
      replaceLocalDrawings(restored);
      reconcileSelection(restored);
    } catch (undoError) {
      alert(
        `撤销画图失败: ${
          undoError instanceof Error ? undoError.message : '网络异常'
        }`
      );
    } finally {
      historyOperationRef.current = false;
    }
  }, [
    persistence,
    reconcileSelection,
    replaceLocalDrawings,
    symbol,
    timeframe,
    undoStack,
    waitForPendingSaves,
  ]);

  const redo = useCallback(async () => {
    if (redoStack.length === 0 || historyOperationRef.current) return;
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
      const saved = await replaceDrawings(
        DRAWING_SCOPE,
        symbol,
        timeframe,
        next.map(serializeDrawing)
      );
      setUndoStack((stack) =>
        [...stack, current].slice(-MAX_HISTORY_ENTRIES)
      );
      setRedoStack((stack) => stack.slice(0, -1));
      const restored = saved.map(deserializeDrawing);
      replaceLocalDrawings(restored);
      reconcileSelection(restored);
    } catch (redoError) {
      alert(
        `重做画图失败: ${
          redoError instanceof Error ? redoError.message : '网络异常'
        }`
      );
    } finally {
      historyOperationRef.current = false;
    }
  }, [
    persistence,
    reconcileSelection,
    redoStack,
    replaceLocalDrawings,
    symbol,
    timeframe,
    waitForPendingSaves,
  ]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
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
