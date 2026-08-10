# TiaBTC Workspace Agent Guide

本文件是后续 AI 与开发者修改本项目时的首要工程说明。开始工作前，应先阅读本文件以及与任务直接相关的代码；不要依据历史迁移文档推断当前架构。

## 1. 项目目标

本项目是一个本地运行的交易学习与复盘工作台，包含三个入口：

1. **顺序学习**：管理 TiaBTC 公开视频的学习状态，并可从视频发布时间进入行情复盘。
2. **行情复盘**：查看 Bybit 永续合约 K 线、成交量、自由回放、持久化画图和模拟交易。
3. **bit浪浪实盘分析**：读取导入的历史交割单，左侧选择交易，右侧显示对应 K 线、成交量和开平仓标记。

默认入口是顺序学习。项目只保留 React/Vite 前端入口，不要重新引入旧版独立 HTML 页面。

## 2. 当前架构

```text
start-workspace.cmd
    └─ start-workspace.ps1
       ├─ React 18 + Vite + TypeScript     http://127.0.0.1:3000
       └─ Python ThreadingHTTPServer API   http://127.0.0.1:8765
          ├─ CCXT / Bybit USDT Perpetual
          └─ tiabtc-review.sqlite
```

- 前端目录：`web/`
- 前端入口：`web/src/app/AppShell.tsx`
- 后端入口：`study_server.py`
- 行情提供器：`market_data_provider.py`
- SQLite 数据库：`tiabtc-review.sqlite`
- 视频快照：`web/public/videos.json`
- Bit浪浪交割单快照：`web/public/bitlang-trades.json`
- 一键启动：`start-workspace.cmd`
- 运行日志：`.run/`

Python 后端是纯 API 服务。禁止恢复项目目录静态文件服务；数据库、源代码和配置文件不能通过 8765 端口访问。

## 3. 不可破坏的业务约束

### 3.1 行情数据

- 唯一在线行情来源是 **CCXT 封装的 Bybit USDT 永续合约**。
- 不要绕过 CCXT 重新加入 `urllib`、浏览器直连 Bybit 或第二套行情请求实现。
- 行情复盘与 Bit浪浪分析共用 `market_candles` 和 `market_cache_ranges`。
- SQLite 是本地行情缓存，不是独立行情源。
- 请求时应优先读取 SQLite，只下载缺失区间，并合并相邻缓存范围。
- 支持周期：`1`、`5`、`15`、`60`、`240`、`D`、`W`。
- K 线必须包含 `volume`，成交量使用独立副图展示。
- CCXT 请求需要遵守限频；不要移除现有锁、请求去重和缺口缓存机制。

### 3.2 时间

- API、领域对象和图表内部时间统一使用 **Unix 毫秒**。
- Lightweight Charts 的 `UTCTimestamp` 只在图表适配边界转换为秒。
- 交易数据中的 `entryTime`、`exitTime` 必须带明确时区。
- 用户界面统一按 `Asia/Shanghai` 显示。
- 十字线完整时间格式为：`YYYY-MM-DD HH:mm 周X`。
- 不要通过固定加减 8 小时修正显示，应使用显式时区转换。

### 3.3 图表视口

- 点击 Bit浪浪中的任意交易后，该交易的开平仓区间必须位于图表中央。
- 切换周期后仍必须重新定位所选交易，不能停留在旧周期视口。
- 向左或向右接近边界时可以自动延展 K 线。
- 延展和缩放不能把视口强制跳到最右端。
- 追加新 K 线时必须保持用户当前可视范围。
- 双击 K 线用于定位对应时间，不要覆盖该交互。
- 进入行情复盘页面并完成首屏 K 线加载后，键盘 `ArrowRight` 必须可以直接开始或推进自由回放，不要求先点击图表、工具栏或回放按钮获取焦点。
- 尚未进入回放时，首次按 `ArrowRight` 应以图表当前定位时间为起点进入自由回放；已有回放上下文时，每次按键推进下一根 K 线。焦点位于输入框、文本域或下拉框时不得触发该快捷键。

### 3.4 画图

- 画完一个图形后，工具必须自动回到选择指针。
- **行情复盘**画图可以通过 `/api/chart/drawings` 持久化。
- **Bit浪浪实盘分析**画图必须使用内存模式：
  - 当时可以新增、拖动、锁定、删除、清空、撤销和重做；
  - 不读取或调用任何画图持久化接口；
  - 刷新页面后消失；
  - 切换 Symbol 或周期后清空对应临时画图。
- 视频发布时间标记和交易开平仓标记属于 System Marker，禁止写入 `chart_drawings`。
- 不要把 Bit浪浪交割单交易与模拟交易混为一类。

### 3.5 Bit浪浪交割单

- 浏览器读取 `web/public/bitlang-trades.json`，运行时不直接读取 Excel。
- 原始工作簿只读；重新导入使用 `scripts/import_bitlang_trades.py`。
- `BTC-USDT-SWAP` 等交割单名称只在适配层转换为 Bybit Symbol，例如 `BTCUSDT`。
- 左侧筛选、排序和分页不能修改原始交易数组。
- 持仓时间筛选口径是：`holdingMinutes` **严格大于**用户输入的分钟数。

## 4. 数据安全

- 不删除或覆盖 `tiabtc-review.sqlite`。
- 不批量修改历史 K 线、画图、学习状态或模拟交易。
- 数据库变更必须先说明表结构、兼容方式、回滚方案和历史数据影响。
- 不执行生产数据库写操作。
- 不将账号、密码、Token、代理地址或连接串写入仓库。
- 不覆盖用户未确认的工作区改动，不执行 `git reset --hard` 或类似破坏性命令。
- 清理文件前先通过引用搜索确认其不属于当前运行链路。

## 5. 修改原则

- 保持最小变更，沿用现有目录、组件、API 封装和 CSS Token。
- 不创建新的独立入口；导航统一由 `AppShell.tsx` 管理。
- 不在组件内散落新的行情请求，应通过 `web/src/api/market-api.ts`。
- 不为一次修复引入大型框架或新的状态管理库。
- 不批量格式化无关文件。
- 性能优化应优先考虑：
  - 避免重复网络请求和 JSON 解析；
  - 避免图表鼠标事件中的线性扫描；
  - 增量追加而不是全量重建；
  - 保持视口而不是自动 `fitContent`；
  - 大列表使用 memo、延迟筛选和分页。

## 6. 重要文件

| 文件 | 责任 |
| --- | --- |
| `start-workspace.ps1` | 检查依赖、启动前后端、打开指定工作台 |
| `study_server.py` | API、SQLite 表、行情缓存、画图和模拟交易持久化 |
| `market_data_provider.py` | CCXT Bybit 行情适配、代理和限频 |
| `web/src/app/AppShell.tsx` | 三个工作台导航、主题和连接状态 |
| `web/src/chart/ChartCanvas.tsx` | K 线、成交量、视口、十字线和边界加载 |
| `web/src/chart/chart-time.ts` | 毫秒/秒边界转换和北京时间格式化 |
| `web/src/features/review-workspace/ChartWorkspace.tsx` | 行情与视频复盘组合 |
| `web/src/features/review-workspace/useDrawingWorkspace.ts` | server/memory 两种画图模式 |
| `web/src/features/bitlang/BitlangTradeWorkspace.tsx` | 交割单列表、筛选、交易定位和临时画图 |
| `web/src/features/learning/LearningWorkspace.tsx` | 视频列表、筛选和学习状态 |

## 7. 工作流程

1. 阅读本文件及相关代码。
2. 使用 `rg` 确认入口、调用链和引用关系。
3. 检查 `git status`，区分用户已有改动和本次改动。
4. 说明问题原因和修改边界。
5. 使用 `apply_patch` 做最小修改。
6. 先做语法和静态检查，再按任务风险进行人工回归。
7. 输出改动文件、核心逻辑、风险点和人工回归建议。

未经用户明确允许：

- 不新增测试类或大批测试文件；
- 不执行编译、打包或部署；
- 不启动长期驻留的新服务；
- 不提交、推送或重置 Git；
- 不删除未确认文件。

允许进行与改动直接相关的只读检查、语法解析、`git diff --check` 和已有本地页面的功能验证。

## 8. 人工回归基线

涉及图表或行情时至少检查：

1. 三个顶部入口均可进入，默认打开顺序学习。
2. 亮色/暗色主题可切换。
3. `1m/5m/15m/1h/4h/1d/1w` 能切换。
4. K 线与成交量副图同时显示。
5. 缩放、拖动和左右延展不跳动。
6. 十字线时间为北京时间完整格式。
7. Bit浪浪点击交易后开平仓区间居中。
8. Bit浪浪临时画图可用但刷新后消失。
9. 行情复盘持久化画图仍可正常读取和保存。
10. 控制台没有未处理异常，接口错误能显示可理解的信息。
