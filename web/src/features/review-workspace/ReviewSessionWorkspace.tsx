import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, RefreshCw } from 'lucide-react';
import {
  createReviewSession, fetchReviewSession, fetchReviewSessions, updateReviewSession,
  type ReviewMarket, type ReviewSession, type ReviewSessionState, type ReviewSessionSummary,
} from '@/api/review-session-api';
import type { PersistedDrawing } from '@/domain/drawing';
import type { VideoReviewContext } from '@/domain/review-context';
import { formatChartTime } from '@/chart/chart-time';
import { readLocalUiState, writeLocalUiState } from '@/ui/persistence/local-ui-state';
import { toast } from '@/ui/feedback/toast';
import { ChartWorkspace } from './ChartWorkspace';
import '@/styles/review-sessions.css';

export type ReviewArchiveSnapshot = {
  state: ReviewSessionState;
  drawings: PersistedDrawing[];
  ready: boolean;
  flushDrawings: () => Promise<void>;
  savingDrawings: boolean;
};

type PendingState = { id: string; state: ReviewSessionState; signature: string };
type ArchiveError = {
  message: string;
  source: 'state' | 'operation' | 'list' | 'restore';
  retry?: () => Promise<void>;
};

export function ReviewSessionWorkspace({ initialVideoContext, themeMode = 'dark', market = 'perpetual' }: {
  initialVideoContext?: VideoReviewContext | null;
  themeMode?: 'dark' | 'light';
  market?: ReviewMarket;
}) {
  const storageKey = `tiabtc-review-session-${market}-v1`;
  const [initialId] = useState(() => {
    const id = readLocalUiState(storageKey).id;
    return !initialVideoContext && typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : '';
  });
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [restoring, setRestoring] = useState(Boolean(initialId));
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<ReviewSessionSummary[]>([]);
  const [title, setTitle] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [savingDrawings, setSavingDrawings] = useState(false);
  const [error, setError] = useState<ArchiveError | null>(null);
  const snapshotRef = useRef<ReviewArchiveSnapshot | null>(null);
  const pendingRef = useRef<PendingState | null>(null);
  const queuedRef = useRef<PendingState | null>(null);
  const timerRef = useRef<number | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const savedSignatureRef = useRef('');
  const activeIdRef = useRef('');
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  const activate = useCallback((next: ReviewSession | null) => {
    if (!mountedRef.current) return;
    activeIdRef.current = next?.id ?? '';
    savedSignatureRef.current = next ? JSON.stringify(next.state) : '';
    snapshotRef.current = null;
    setSession(next);
    setTitle(next?.title ?? '');
    setError(null);
    setStatus(next ? '已保存' : '公共画线，尚未归档');
    writeLocalUiState(storageKey, { id: next?.id ?? '' });
  }, [storageKey]);

  const flushState = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    if (!pending) return chainRef.current;
    pendingRef.current = null;
    queuedRef.current = pending;
    const operation = chainRef.current.catch(() => undefined).then(() =>
      updateReviewSession(pending.id, { state: pending.state })
    ).then(() => {
      if (activeIdRef.current === pending.id) {
        savedSignatureRef.current = pending.signature;
        if (mountedRef.current) {
          setError((current) => current?.source === 'state' ? null : current);
          setStatus(pendingRef.current || queuedRef.current !== pending ? '待保存…' : '已保存');
        }
      }
    }).catch((cause: unknown) => {
      // An older failed write must not overwrite a newer queued snapshot.
      if (queuedRef.current === pending && !pendingRef.current) pendingRef.current = pending;
      if (mountedRef.current && activeIdRef.current === pending.id) {
        setStatus('保存失败');
        setError({ source: 'state', message: cause instanceof Error ? cause.message : '档案保存失败' });
      }
      throw cause;
    }).finally(() => {
      if (queuedRef.current === pending) queuedRef.current = null;
    });
    chainRef.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const handlePageHide = () => { void flushState().catch(() => undefined); };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', handlePageHide);
      void flushState().catch(() => undefined);
    };
  }, [flushState]);

  useEffect(() => {
    if (!initialId) return;
    let cancelled = false;
    void fetchReviewSession(initialId).then((record) => {
      if (record.market !== market) throw new Error('档案所属市场不匹配');
      if (!cancelled) { activate(record); setRestoring(false); }
    }).catch((cause: unknown) => {
      if (!cancelled) setError({ source: 'restore', message: `打开上次复盘失败：${cause instanceof Error ? cause.message : '读取失败'}` });
    });
    return () => { cancelled = true; };
  }, [activate, initialId, market]);

  const onSnapshotChange = useCallback((snapshot: ReviewArchiveSnapshot) => {
    snapshotRef.current = snapshot;
    setSavingDrawings(snapshot.savingDrawings);
    const id = activeIdRef.current;
    if (!id) return;
    const signature = JSON.stringify(snapshot.state);
    if (signature === pendingRef.current?.signature) return;
    const queued = queuedRef.current;
    const targetSignature = queued?.id === id ? queued.signature : savedSignatureRef.current;
    if (signature === targetSignature) {
      // A→B→A cancels an unsent B. If B is already queued, A must instead
      // be saved after it, even though A still matches the last stored state.
      pendingRef.current = null;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!queued) {
        chainRef.current = chainRef.current.catch(() => undefined);
        setError((current) => current?.source === 'state' ? null : current);
      }
      setStatus(queued ? '保存中…' : '已保存');
      return;
    }
    pendingRef.current = { id, state: snapshot.state, signature };
    setStatus('待保存…');
    if (timerRef.current === null) timerRef.current = window.setTimeout(() => {
      void flushState().catch(() => undefined);
    }, 300);
  }, [flushState]);

  const runTransition = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      await snapshotRef.current?.flushDrawings();
      await flushState();
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '未知错误';
      setError({ source: 'operation', message, retry: action });
      toast.error(`复盘档案操作失败：${message}。当前画图已保留，请重试`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const beginArchive = (state: ReviewSessionState, copyCurrentDrawings = false) =>
    runTransition(async () => {
      const snapshot = snapshotRef.current;
      const next = await createReviewSession(market,
        copyCurrentDrawings && snapshot ? snapshot.state : state,
        copyCurrentDrawings && snapshot ? snapshot.drawings : []
      );
      activate(next);
      setSessions((items) => [{ ...next, timeframe: next.state.timeframe, timestampMs: next.state.timestampMs }, ...items]);
    });

  const refreshList = async () => {
    try {
      setSessions(await fetchReviewSessions(market));
      setError((current) => current?.source === 'list' ? null : current);
    }
    catch (cause) {
      setError({ source: 'list', message: cause instanceof Error ? cause.message : '读取档案列表失败', retry: refreshList });
    }
  };

  const openArchive = (id: string) => runTransition(async () => {
    if (!id) { activate(null); return; }
    const next = await fetchReviewSession(id);
    if (next.market !== market) throw new Error('档案所属市场不匹配');
    activate(next);
  });

  const renameArchive = () => runTransition(async () => {
    if (!session || !title.trim()) throw new Error('请输入复盘档案名称');
    const next = await updateReviewSession(session.id, { title: title.trim() });
    setTitle(next.title);
    setSession((current) => current ? { ...current, title: next.title } : current);
    await refreshList();
  });

  const archiveControls = (
    <details className="review-archives" open={panelOpen} onToggle={(event) => {
      setPanelOpen(event.currentTarget.open);
      if (event.currentTarget.open) void refreshList();
    }} onKeyDown={(event) => event.stopPropagation()}>
      <summary className="ui-btn"><Archive size={13} />复盘档案</summary>
      <div className="review-archives-panel">
        <strong>{session?.title || '当前公共画线'}</strong>
        <span role="status">{busy ? '正在处理…' : savingDrawings ? '画图保存中…' : status || '可将当前画图保存为独立档案'}</span>
        <div className="review-archives-actions">
          <button className="ui-btn" type="button" disabled={busy} onClick={() => {
            const snapshot = snapshotRef.current;
            if (!snapshot?.ready) { toast.info('请等待画图加载完成'); return; }
            const state = snapshot.state;
            void beginArchive(session && state.replay ? {
              ...state, videoContext: null,
              replay: { ...state.replay, startTimeMs: state.replay.daySession ? state.replay.startTimeMs : state.replay.cursorTimeMs },
            } : state, !session);
          }}>{session ? '新建复盘' : '保存本次复盘'}</button>
          {session && <button className="ui-btn" type="button" disabled={busy} onClick={() => {
            void runTransition(async () => {
              await refreshList();
              setStatus('已保存');
            });
          }}>立即保存</button>}
        </div>
        {session && <div className="review-archives-actions">
          <input aria-label="复盘档案名称" className="ui-input" maxLength={100}
            value={title} onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void renameArchive(); }} />
          <button className="ui-btn" type="button" disabled={busy} onClick={() => void renameArchive()}>保存名称</button>
        </div>}
        <label>打开已有复盘
          <select aria-label="打开复盘档案" value={session?.id ?? ''} disabled={busy}
            onChange={(event) => { void openArchive(event.target.value); }}>
            <option value="">公共画线（历史数据）</option>
            {session && !sessions.some((item) => item.id === session.id) &&
              <option value={session.id}>{session.title}</option>}
            {sessions.map((item) => <option key={item.id} value={item.id}>
              {item.title} · {item.symbol} · {formatChartTime(item.timestampMs)} · {item.drawingCount} 个标注
            </option>)}
          </select>
        </label>
        <small>档案内的画图自动保存，可跨周期继续编辑。新建复盘使用独立画线。</small>
        {error && <span className="review-archives-error" role="alert">{error.message}
          <button className="ui-btn" type="button" disabled={busy} onClick={() => {
            void runTransition(error.retry ?? refreshList);
          }}>重试</button>
        </span>}
      </div>
    </details>
  );

  if (restoring) return <div className="review-session-restoring" role="status">
    {error?.message || <><RefreshCw size={16} className="spin" />正在打开上次复盘…</>}
    {error && <button type="button" className="ui-btn" onClick={() => {
      void runTransition(async () => {
        const record = await fetchReviewSession(initialId);
        if (record.market !== market) throw new Error('档案所属市场不匹配');
        activate(record); setRestoring(false);
      });
    }} disabled={busy}>重试打开</button>}
    {error && <button type="button" className="ui-btn" onClick={() => {
      activate(null); setRestoring(false);
    }}>返回公共画线</button>}
  </div>;

  return <ChartWorkspace key={session?.id ?? 'public'}
    initialSession={session} initialVideoContext={session ? session.state.videoContext : initialVideoContext}
    themeMode={themeMode} market={market} archiveControls={archiveControls}
    onArchiveSnapshotChange={onSnapshotChange} onBeginArchive={beginArchive} archiveBusy={busy} />;
}
