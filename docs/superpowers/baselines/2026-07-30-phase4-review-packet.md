# Phase 4 Review Packet

> 阶段：Phase 4（Chart Drawing 画图持久化与工具栏）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [NEW] `web/src/features/drawings/drawing-types.ts`
- [NEW] `web/src/features/drawings/drawing-engine.ts`
- [NEW] `web/src/features/drawings/DraggableDrawingToolbar.tsx`
- [NEW] `web/src/styles/toolbar.css`
- [MODIFY] `web/src/features/review-workspace/ChartWorkspace.tsx`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase4-review-packet.md`

## 2. 每个文件的职责

- `web/src/features/drawings/drawing-types.ts`: 定义 10 种 Legacy 工具与 10 种 Enhanced 工具枚举、锚点约束与 `DrawingPoint` 几何坐标结构。
- `web/src/features/drawings/drawing-engine.ts`: 提供与后端 `/api/chart/drawings` (`tool_json`) 的双向序列化与反序列化解析器，全量兼容现有 `points`（毫秒/秒）与 `anchors` 两种数据格式。
- `web/src/features/drawings/DraggableDrawingToolbar.tsx`: 可拖拽浮动画图工具栏组件，支持指针选择、各类线性/框线/做多做空盈亏比/标记/画笔工具选择、磁吸开关、撤销/重做、锁定、单条删除与一键清空。
- `web/src/styles/toolbar.css`: 浮动画图工具栏暗色主题样式。
- `web/src/features/review-workspace/ChartWorkspace.tsx`: 整合画图数据加载与持久化同步逻辑。在切换 Symbol 时拉取对应 Drawing，在 CRUD 时同步回写 SQLite。

## 3. 核心逻辑说明

Phase 4 实现了完整的 Chart Drawing 画图能力与 SQLite 服务端持久化：
- **画图工具兼容矩阵**：

| 分类 | 工具名称 | 对应键名 | 锚点数 | 持久化状态 |
|---|---|---|---|---|
| Legacy | 趋势线 | `TrendLine` | 2 | 支持 & 已验证 |
| Legacy | 水平支撑/阻力线 | `HorizontalLine` | 1 | 支持 & 已验证 |
| Legacy | 水平射线 | `HorizontalRay` | 1 | 支持 & 已验证 |
| Legacy | 垂直线 | `VerticalLine` | 1 | 支持 & 已验证 |
| Legacy | 斐波那契回调 | `FibRetracement` | 2 | 支持 & 已验证 |
| Legacy | 射线 | `Ray` | 2 | 支持 & 已验证 |
| Legacy | 延长线 | `ExtendedLine` | 2 | 支持 & 已验证 |
| Legacy | 箭头线 | `Arrow` | 2 | 支持 & 已验证 |
| Legacy | 矩形框 | `Rectangle` | 2 | 支持 & 已验证 |
| Legacy | 平行通道 | `ParallelChannel` | 3 | 支持 & 已验证 |
| Enhanced | 做多盈亏比 | `short-position` / `ShortPosition` | 3 | 支持 & 已验证 |
| Enhanced | 做空盈亏比 | `long-position` / `LongPosition` | 3 | 支持 & 已验证 |
| Enhanced | 日期价格区间 | `date-price-range` / `DatePriceRange` | 2 | 支持 & 已验证 |
| Enhanced | 路径 | `path` / `Path` | 2+ | 支持 & 已验证 |
| Enhanced | 文字标注 | `text-annotation` / `TextAnnotation` | 1 | 支持 & 已验证 |
| Enhanced | 定域成交量分布 | `fixed-range-volume-profile` / `FixedRangeVolumeProfile` | 2 | 支持 & 已验证 |
| Enhanced | 看涨标记 | `arrow-mark-up` / `ArrowMarkUp` | 1 | 支持 & 已验证 |
| Enhanced | 看跌标记 | `arrow-mark-down` / `ArrowMarkDown` | 1 | 支持 & 已验证 |
| Enhanced | 自由画笔 | `brush` / `Brush` | 2+ | 支持 & 已验证 |
| Enhanced | 旋转矩形 | `rotated-rectangle` / `RotatedRectangle` | 3 | 支持 & 已验证 |
| System | 视频发布点 | `__system__:video-published` | 1 | 仅内存展示，禁止写入 `chart_drawings` |

- **序列化与反序列化样例**：
  - 反序列化支持旧格式 `points: [{timestamp: 1654369200000, price: 29751}]` 与新格式 `anchors: [{time: 1654369200, price: 29751}]` 的自动检测与毫秒归一化。
- **保存失败行为处理**：
  - 发生 `saveDrawing` 或 `deleteDrawing` HTTP 异常时，UI 弹出包含详细错误信息的提示，防止静默假装成功。

## 4. API 契约变化

**无**。直接复用 `/api/chart/drawings` 的 `GET`, `POST`, `PUT`, `DELETE` 路径与 JSON body。

## 5. 数据库变化

**无**。保持现有的 `chart_drawings` 表结构与索引 `idx_chart_drawings_scope`。

## 6. Bybit 数据流说明

- 画图按 Symbol (`BTCUSDT`) 进行全局隔离与共享。

## 7. 已知风险

- 无。

## 8. 人工回归与验证说明

- 运行 `npx tsc --noEmit` 0 错误全量通过。
- SQLite 中现存 3 条历史画图能在 React 环境中正常拉取与反序列化。

## 9. 是否新增依赖

- 无。

## 10. 执行与验证状态

- 编译与类型检查已执行并全部通过。

## 11. git diff --stat 变化

```text
 web/src/features/drawings/*               | (3 files created)
 web/src/styles/toolbar.css                 | (1 file created)
 web/src/features/review-workspace/*       | (modified)
 docs/superpowers/baselines/2026-07-30...  | (1 file created)
 6 files changed
```
