# Phase 0 Review Packet

> 阶段：Phase 0（冻结基线和记录兼容契约）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [NEW] `docs/superpowers/baselines/2026-07-30-phase0-baseline-snapshot.md`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase0-review-packet.md`

## 2. 每个文件的职责

- `2026-07-30-phase0-baseline-snapshot.md`: 记录两个仓库 Commit SHA、数据库建表 DDL 与行数、API 接口清单、Drawing 工具兼容矩阵以及业务代码无修改声明。
- `2026-07-30-phase0-review-packet.md`: Phase 0 的规范化审查数据包。

## 3. 核心逻辑说明

Phase 0 为冻结与准备阶段。本阶段不改动任何业务逻辑、数据库表结构或接口实现，只对现有代码与数据库进行只读检查与契约文档固化。

## 4. API 契约变化

**无**。保持 `study_server.py` 所有 13 个 REST API 路径及参数格式 100% 相同。

## 5. 数据库变化

**无**。SQLite 数据库 `tiabtc-review.sqlite` 未发生任何 DDL 或 DML 修改。

## 6. Bybit 数据流说明

保持主仓库语义：行情数据源为 Bybit。K线存储与读取通过 `market_candles` 与 `market_cache_ranges` 表完成，禁止引入 OKX URL 或 OKX 格式（如 `BTC-USDT-SWAP`）。

## 7. 已知风险

- 参考仓库 `BitLanglangReview` 的 Working Tree 包含某些 OKX 依赖和开发调试脚本，在后续 React 组件改写中须严格剥离，只能吸收图表视口、导航 Anchor 与筛选逻辑。

## 8. 人工回归建议

- 启动 `study_server.py` 验证既有 `TiaBTC_学习视频清单.html` 与 `TiaBTC_K线复盘.html` 是否能正常加载并展现数据。
- 检查 `tiabtc-review.sqlite` 的修改时间戳，确保其未因 Phase 0 被写入。

## 9. 是否新增依赖

**无**。未新增 npm 包或 Python 依赖。

## 10. 执行与验证状态

- 数据库操作：只读查询校验完成。
- 测试/编译/启动：按约束未主动编译或修改代码。

## 11. git diff --stat

```text
 docs/superpowers/baselines/2026-07-30-phase0-baseline-snapshot.md | 150 ++++++++++++++++++++
 docs/superpowers/baselines/2026-07-30-phase0-review-packet.md    |  45 ++++++
 2 files changed, 195 insertions(+)
```

## 12. 未确认用户改动是否与本阶段文件重叠

- 未重叠。未修改用户根目录下的任何其它文件。
