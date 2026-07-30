# Phase 2 Review Packet

> 阶段：Phase 2（统一 Chart Workspace 和 Bybit Candlestick）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [NEW] `web/src/chart/chart-time.ts`
- [NEW] `web/src/chart/chart-viewport.ts`
- [NEW] `web/src/chart/chart-navigation-anchor.ts`
- [NEW] `web/src/chart/chart-autoload.ts`
- [NEW] `web/src/chart/candlestick-readout.ts`
- [NEW] `web/src/chart/ChartCanvas.tsx`
- [NEW] `web/src/features/review-workspace/ChartWorkspace.tsx`
- [MODIFY] `web/src/app/AppShell.tsx`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase2-review-packet.md`

## 2. 每个文件的职责

- `web/src/chart/chart-time.ts`: 负责 Unix 毫秒时间戳与 Lightweight Charts `UTCTimestamp`（秒）的互转，以及基于上海时区的时间格式化。
- `web/src/chart/chart-viewport.ts`: 负责捕获与恢复图表的逻辑视口及时间范围。
- `web/src/chart/chart-navigation-anchor.ts`: 计算导航锚点，保障平滑装载。
- `web/src/chart/chart-autoload.ts`: 提供基于 LogicalRange 判断向左滑动是否需增量加载更早 K 线的算法。
- `web/src/chart/candlestick-readout.ts`: 负责开/高/低/收、涨跌幅及成交量的格式化朗读。
- `web/src/chart/ChartCanvas.tsx`: React Lightweight Charts 核心画布组件，实现图表生命周期管理、对数/普通坐标切换、Crosshair 移动订阅、ResizeObserver 自适应与更早 K 线装载时视口防跳动。
- `web/src/features/review-workspace/ChartWorkspace.tsx`: 图表复盘工作区组件，支持 Symbol 选择与新增、6 种 Bybit 时间周期切换、对数坐标切换、OHLC 实时数据头部 Bar 及 Offline 离线缓存警示。
- `web/src/app/AppShell.tsx`: 嵌入 `ChartWorkspace` 作为主页面区。

## 3. 核心逻辑说明

Phase 2 在 React 中完成了只读 K 线图表展示与稳定导航：
- 时间单位全流程保持在领域层为 Unix 毫秒 `timestampMs`，仅在图表渲染时转为 `UTCTimestamp`（秒）。
- 切换 Symbol 或 Timeframe 时，Context Key 动态变更并瞬间清理旧数据，彻底防止跨 Context 串数据。
- 使用 `AbortController` 保护所有 K 线异步请求，消除滞后响应污染图表状态。
- 向左拖拽触顶时触发 `handleLoadEarlier`，并通过追加数据后重置 `setVisibleLogicalRange` 保证平滑无跳跃。
- 缺缓存时显示服务端 Offline 提示，不假装网络正常。

## 4. API 契约变化

**无**。全量复用 `/api/chart/candles` 及 `/api/symbols` 现有 API，不增删改。

## 5. 数据库变化

**无**。未改变 Python 后端或 SQLite 数据库。

## 6. Bybit 数据流说明

- 所有 Market Data 接口严格遵循 Bybit Symbol 命名与 6 种标准时间周期（`5`, `15`, `60`, `240`, `D`, `W`）。
- 禁止 OKX 时间边界补丁与 `BTC-USDT-SWAP` 标识。

## 7. 已知风险

- 无。

## 8. 人工回归与验证说明

- 运行 `npx tsc --noEmit` 0 错误通过。
- 图表视口在加载更早 K 线时保持稳定。

## 9. 是否新增依赖

- 未新增额外 npm 包或依赖。

## 10. 执行与验证状态

- 编译与类型检查已执行并全部通过。

## 11. git diff --stat 变化

```text
 web/src/chart/*                           | (6 files created)
 web/src/features/review-workspace/*      | (1 file created)
 web/src/app/AppShell.tsx                 | (modified)
 docs/superpowers/baselines/2026-07-30... | (1 file created)
 9 files changed
```
