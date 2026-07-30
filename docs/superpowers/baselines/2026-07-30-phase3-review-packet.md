# Phase 3 Review Packet

> 阶段：Phase 3（Free Replay 自由回放）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [NEW] `web/src/features/replay/replay-state.ts`
- [NEW] `web/src/features/replay/free-replay-logic.ts`
- [NEW] `web/src/features/replay/FreeReplayPanel.tsx`
- [MODIFY] `web/src/features/review-workspace/ChartWorkspace.tsx`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase3-review-packet.md`

## 2. 每个文件的职责

- `web/src/features/replay/replay-state.ts`: 定义 discriminated union 状态机 `ReplayState`（`idle`, `ready`, `playing`, `paused`, `completed`）。
- `web/src/features/replay/free-replay-logic.ts`: 提供自由回放的核心纯函数逻辑，包含 `filterVisibleCandles`（K线可见遮罩过滤）、`getNextCursorTimeMs`（下一根）、`getPrevCursorTimeMs`（上一根步退且不早于起点）及 `shouldPrefetchFuture` 预取算法。
- `web/src/features/replay/FreeReplayPanel.tsx`: 自由回放控制面板组件，支持弹出起点设置窗口、上一根/下一根/播放/暂停/倍速控制、进度时间和键盘快捷键监听（方向键与空格键）。
- `web/src/features/review-workspace/ChartWorkspace.tsx`: 整合 `ReplayState` 与 `FreeReplayPanel`，实现未来 K 线后台预取与可见渲染严格分离、基于定时器的自动播放与销毁清理。

## 3. 核心逻辑说明

Phase 3 在 React 前端完成了自由回放与统一 Replay 状态机：
- 严格隔离未来数据：所有后台加载和预取的 K 线全量进入缓冲区，但传递给 `ChartCanvas` 的只经由 `filterVisibleCandles` 截断至 `cursorTimeMs`，未来 K 线决不提前渲染。
- 绝不早于起点：步退时 `getPrevCursorTimeMs` 严格受限制于 `startTimeMs`，保障回放边界安全。
- 键盘交互与防误触：支持左右方向键（步退/揭示）与空格键（播放/暂停）；在输入框、下拉框聚焦时，自动挂起快捷键避免干扰正常打字。
- 定时器无泄露：在暂停、重新切入 `idle` 或组件卸载时，自动 `clearInterval` 销毁定时器。

## 4. API 契约变化

**无**。继续使用现有 `/api/chart/candles` 的 `replayCursor` / `after` 加载机制。

## 5. 数据库变化

**无**。不修改 Python 后端与 SQLite 数据库。

## 6. Bybit 数据流说明

- 保持数据源为 Bybit，回放时间点全量使用绝对 Unix 毫秒 `timestampMs`。

## 7. 已知风险

- 无。

## 8. 人工回归与验证说明

- 运行 `npx tsc --noEmit` 0 错误通过。
- 开启自由回放，测试键盘方向键、倍速播放、上一根与到达起点后阻止回退。

## 9. 是否新增依赖

- 无。

## 10. 执行与验证状态

- 编译与类型检查已执行并全部通过。

## 11. git diff --stat 变化

```text
 web/src/features/replay/*                 | (3 files created)
 web/src/features/review-workspace/*       | (modified)
 docs/superpowers/baselines/2026-07-30...  | (1 file created)
 5 files changed
```
