# Phase 6 Review Packet

> 阶段：Phase 6（Video Review 视频发布点复盘与 System Marker）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [MODIFY] `web/src/chart/chart-time.ts`
- [NEW] `web/src/chart/system-marker.ts`
- [MODIFY] `web/src/chart/ChartCanvas.tsx`
- [MODIFY] `web/src/features/review-workspace/ChartWorkspace.tsx`
- [MODIFY] `web/src/app/AppShell.tsx`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase6-review-packet.md`

## 2. 每个文件的职责

- `web/src/chart/chart-time.ts`: 增加 `parseVideoPublishedTimeMs(dateStr, timeStr)` 纯函数，精准解析 UTC/夏令时与北京时间转算为毫秒级绝对 Unix 时间戳。
- `web/src/chart/system-marker.ts`: 提供内存级 `__system__:video-published` System Marker 时间点标记，排除在持久化逻辑外。
- `web/src/chart/ChartCanvas.tsx`: 增加 `systemMarkers` 渲染支持，调用 `series.setMarkers` 将视频发布标记精确定位于 K 线图表上方。
- `web/src/features/review-workspace/ChartWorkspace.tsx`: 接入 `VideoReviewContext`。进入视频复盘时以视频发布时间为 Anchor，初始严格遮罩并隔离未来 K 线，支持复用 Free Replay 按钮进行逐根推进与步退。
- `web/src/app/AppShell.tsx`: 从视频列表点击“复盘分析”时调起 `VideoReviewContext`，携带属性平滑跳转至行情复盘工作区。

## 3. 核心逻辑说明

Phase 6 彻底收敛消除了旧版基于单个 `videoId` 进行 K 线与画图隔离的死穴：
- **发布时间精确转换**：通过 `parseVideoPublishedTimeMs` 将视频发布日期时间转换为 Unix 毫秒。无论是 UTC 偏移格式（`-07:00`）还是北京时间（`Asia/Shanghai`），均归一化为绝对时间戳。
- **未来 K 线初始隔离**：以视频发布时间为回放起点，初始渲染时自动遮罩隐藏发布点之后的 K 线。用户可使用播放控制栏（步进、步退、播放、倍速）逐步披露后续行情发展。
- **内存级 System Marker**：`__system__:video-published` 生成的黄框标记（`🎬 发布: 标题`）仅保存在 Chart Canvas 内存视图中，绝不写入 SQLite `chart_drawings` 数据库。
- **同 Symbol 画图全量共享**：Drawing 按 Symbol (`BTCUSDT`) 共享作用域。用户在视频 A 中绘制的趋势线或支撑阻力框，在打开视频 B 或自由回放模式时依然完好无损地呈现。

## 4. API 契约变化

**无**。

## 5. 数据库变化

**无**。System Marker 明确禁止写入 SQLite `chart_drawings` 表。

## 6. Bybit 数据流说明

- 行情历史 K 线由统一的 `BTCUSDT` Bybit 数据库提供支持。

## 7. 已知风险

- 无。

## 8. 人工回归与验证说明

- 运行 `npx tsc --noEmit` 0 错误通过。
- 在视频列表中挑选视频并点击“复盘分析”，定位准确，发布时间之后的 K 线初始隐藏，显示黄金标记。
- 在视频中绘制画线，切换其他视频，画线依然完好保留。

## 9. 是否新增依赖

- 无。

## 10. 执行与验证状态

- 编译、构建与类型检查已执行并全部通过。

## 11. git diff --stat 变化

```text
 web/src/chart/chart-time.ts               | (modified)
 web/src/chart/system-marker.ts            | (1 file created)
 web/src/chart/ChartCanvas.tsx            | (modified)
 web/src/features/review-workspace/*      | (modified)
 web/src/app/AppShell.tsx                 | (modified)
 docs/superpowers/baselines/2026-07-30... | (1 file created)
 6 files changed
```
