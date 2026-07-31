# Phase 7 Review Packet

> 阶段：Phase 7（Paper Trading 模拟开仓交易与盈亏比联动）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [MODIFY] `web/src/domain/paper-trade.ts`
- [NEW] `web/src/features/paper-trading/paper-trade-types.ts`
- [NEW] `web/src/features/paper-trading/paper-trade-logic.ts`
- [NEW] `web/src/features/paper-trading/PaperTradingPanel.tsx`
- [NEW] `web/src/styles/paper-trading.css`
- [MODIFY] `web/src/api/paper-trade-api.ts`
- [MODIFY] `web/src/features/drawings/DraggableDrawingToolbar.tsx`
- [MODIFY] `web/src/features/review-workspace/ChartWorkspace.tsx`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase7-review-packet.md`

## 2. 每个文件的职责

- `web/src/domain/paper-trade.ts`: 充实定义统一的 `PaperTrade` 模拟交易领域实体类型。
- `web/src/features/paper-trading/paper-trade-types.ts`: 模拟交易交互与统计模型接口。
- `web/src/features/paper-trading/paper-trade-logic.ts`: 提供纯函数算法 `calculateRR`（盈亏比计算）、`computePaperTradeStats`（胜率与净 R 收益卡片算法）与 `checkTradeTrigger`（触及 TP 止盈/SL 止损风控触发自动平仓器）。
- `web/src/features/paper-trading/PaperTradingPanel.tsx`: 模拟开仓与交易记录浮动侧边面板，提供交易统计摘要、手动开仓表单、持仓单控制（手动结单）与历史表现展现。
- `web/src/styles/paper-trading.css`: 模拟交易面板暗色终端主题样式。
- `web/src/api/paper-trade-api.ts`: 封装 `/api/paper-trades` REST API（支持 `fetchPaperTrades`, `savePaperTrade`, `deletePaperTrade`）。
- `web/src/features/drawings/DraggableDrawingToolbar.tsx`: 在选中做多/做空盈亏比画图工具时，动态展现 `🎯 模拟开仓` 联动按钮，支持一键带入参数打开交易面板。
- `web/src/features/review-workspace/ChartWorkspace.tsx`: 整合模拟交易面板、后端 `/api/paper-trades` 数据库同步与 K 线推进时的风控自动结单检测。

## 3. 核心逻辑说明

Phase 7 完成了复盘模拟交易的核心迁移与风控闭环：
- **盈亏比画图联动**：在图表上使用 `long-position`（做多盈亏比）或 `short-position`（做空盈亏比）工具绘制目标后，点击工具栏中的 `🎯 模拟开仓` 按钮，系统自动解析并填入开仓价 (Entry)、止盈位 (TP) 和止损位 (SL)，算归出预期盈亏比 R:R。
- **自动风控结单（K 线触碰检测）**：在自由回放或视频复盘推进时，自动校验处于 `OPEN` 状态的持仓单。当一根 OHLC K 线同时覆盖 TP 和 SL 时，因无法还原盘中先后顺序，按保守口径结算为 `LOSS`；其余情况按实际触达方向结算，并调用 `/api/paper-trades` 写库。
- **持久化闭环**：通过后端 `/api/paper-trades` 接口读写 SQLite 数据库 `paper_trades` 表，页面刷新或切换 Symbol 后数据仍可恢复。
- **实时统计**：实时计算展示总交易笔数、持仓数、胜率百分比 (%) 与净收益 (Total R)。

## 4. API 契约变化

前端适配既有 `/api/paper-trades` 路由，并完成 SQLite 下划线字段与前端驼峰字段的转换。

## 5. 数据库变化

**无**。读写既有 SQLite `paper_trades` 表。

## 6. Bybit 数据流说明

- 模拟交易挂钩于 `activeSymbol`（`BTCUSDT`）价格行情。

## 7. 已知风险

- OHLC 数据无法判断同一根 K 线内 TP/SL 的真实触发顺序，当前采用保守的止损优先口径。
- 本轮修复遵守仓库约束，仅完成静态复核；尚未执行 TypeScript 编译或浏览器端运行验证。

## 8. 人工回归与验证说明

- 待人工运行后验证：绘制盈亏比框后点击联动开仓，参数应自动填充。
- 待人工运行后验证：步进 K 线推进，触及止盈线/止损线时应自动结算并写入数据库。
- 待人工运行后验证：同一根 K 线同时覆盖 TP/SL 时应按 `LOSS` 结算。

## 9. 是否新增依赖

- 无。

## 10. 执行与验证状态

- 本轮修复未执行编译、构建、启动或类型检查；仅完成源码、契约与数据文件静态核对。

## 11. git diff --stat 变化

```text
 web/src/domain/paper-trade.ts              | (modified)
 web/src/features/paper-trading/*           | (4 files created)
 web/src/styles/paper-trading.css           | (1 file created)
 web/src/api/paper-trade-api.ts             | (modified)
 web/src/features/drawings/Draggable...   | (modified)
 web/src/features/review-workspace/...     | (modified)
 docs/superpowers/baselines/2026-07-30... | (1 file created)
 9 files changed
```
