# TiaBTC Workspace Agent Guide

本文件是后续 AI 与开发者修改本项目时的首要工程说明。开始工作前，应先阅读本文件以及与任务直接相关的代码；不要依据历史迁移文档推断当前架构。

## 1. 项目目标

本项目是一个本地运行的交易学习与复盘工作台，包含四个入口：

1. **顺序学习**：管理 TiaBTC 公开视频的学习状态，并可从视频发布时间进入行情复盘。
2. **行情复盘**：查看 Bybit 永续合约 K 线、成交量、自由回放、持久化画图和模拟交易。
3. **bit浪浪实盘分析**：读取导入的历史交割单，左侧选择交易，右侧显示对应 K 线、成交量和开平仓标记。
4. **仓位复盘**：读取本机保存的 Bitget UTA 只读密钥，手动同步历史仓位与当前持仓，左侧筛选列表，右侧显示对应 K 线、开平仓标记，并支持备注与标签。

默认入口是顺序学习。项目只保留 React/Vite 前端入口，不要重新引入旧版独立 HTML 页面。不要把仓位复盘与 bit浪浪交割单、模拟交易混为一类。

## 2. 当前架构

```text
start-workspace.cmd
    └─ start-workspace.ps1
       ├─ React 18 + Vite + TypeScript     http://127.0.0.1:3000
       └─ Python ThreadingHTTPServer API   http://127.0.0.1:8765
          ├─ CCXT / Bybit USDT Perpetual   （K 线主源）
          ├─ CCXT / Bitget UTA             （仓位复盘私有账户 + K 线回退）
          └─ tiabtc-review.sqlite
```

- 前端目录：`web/`
- 前端入口：`web/src/app/AppShell.tsx`
- 后端入口：`study_server.py`
- Bybit 行情提供器：`market_data_provider.py`
- Bitget 仓位/回退行情提供器：`bitget_position_provider.py`
- SQLite 数据库：`tiabtc-review.sqlite`
- 视频快照：`web/public/videos.json`
- Bit浪浪交割单快照：`web/public/bitlang-trades.json`
- 一键启动：`start-workspace.cmd`
- 运行日志与本地密钥材料：`.run/`（已 gitignore；含 `credential-key`）

Python 后端是纯 API 服务。禁止恢复项目目录静态文件服务；数据库、源代码和配置文件不能通过 8765 端口访问。

依赖约束：`ccxt>=4.5.56,<5`（Bitget UTA 需要 `params.uta=True`，旧版会忽略），以及 `cryptography`（本地加密 API 密钥）。

## 3. 不可破坏的业务约束

### 3.1 行情数据

- **行情复盘 / bit浪浪 / 顺序学习进复盘** 的 K 线唯一在线来源仍是 **CCXT 封装的 Bybit USDT 永续合约**。K 线不得改走非 CCXT 源。
- **OI/CVD 已退役**：不要恢复行情复盘 OI/CVD 开关、副图、`GET /api/chart/flow` 或启动预热。旧 `market_oi_*` / `market_cvd_*` 表仅作为历史兼容数据保留，不主动删除，也不再自动更新。
- 上述三个入口的 K 线共用 `market_candles` 和 `market_cache_ranges`。
- **仓位复盘** K 线规则：
  - 优先 Bybit（走现有 `market_candles` / `market_cache_ranges`）；
  - 仅当 Bybit 目录中不存在该 USDT 永续 symbol 时，才回退 Bitget；
  - Bitget 回退 K 线写入独立表 `venue_market_candles` / `venue_market_cache_ranges`，禁止与 Bybit 缓存混写。
- 单次 K 线响应上限约 **3000** 根（`MAX_CANDLES_PER_RESPONSE`）。过长仓位/交易窗口截在开仓附近，响应带 `truncated`；前端窗口缓存走 `web/src/api/candle-window-cache.ts` 分片 LRU。不要为了「一次看完全程」去掉该上限。
- SQLite 是本地行情缓存，不是独立行情源。
- 请求时应优先读取 SQLite，只下载缺失区间，并合并相邻缓存范围。
- 支持周期：`1`、`5`、`15`、`60`、`240`、`D`、`W`。
- K 线必须包含 `volume`，成交量使用独立副图展示。
- CCXT 请求需要遵守限频；不要移除现有锁、请求去重和缺口缓存机制。
- 向左/向右延展时若缓存有缺口，可能先返回局部数据并后台补齐，图表会出现时间轴空白（断层）；修改加载策略时不要破坏现有缓存合并语义。

### 3.2 时间

- API、领域对象和图表内部时间统一使用 **Unix 毫秒**。
- Lightweight Charts 的 `UTCTimestamp` 只在图表适配边界转换为秒。
- 交易数据中的 `entryTime`、`exitTime` 必须带明确时区。
- 用户界面统一按 `Asia/Shanghai` 显示。
- 十字线完整时间格式为：`YYYY-MM-DD HH:mm 周X`。
- 不要通过固定加减 8 小时修正显示，应使用显式时区转换。

### 3.3 图表视口

- 点击 Bit浪浪或仓位复盘中的任意交易/仓位后，该笔的开平仓区间必须位于图表中央。
- 切换周期后仍必须重新定位所选交易/仓位，不能停留在旧周期视口。
- 向左或向右接近边界时可以自动延展 K 线。
- 延展和缩放不能把视口强制跳到最右端。
- 追加新 K 线时必须保持用户当前可视范围。
- 双击 K 线用于定位对应时间，不要覆盖该交互。
- 进入行情复盘页面并完成首屏 K 线加载后，键盘 `ArrowRight` 必须可以直接开始或推进自由回放，不要求先点击图表、工具栏或回放按钮获取焦点。
- 尚未进入回放时，首次按 `ArrowRight` 应以图表当前定位时间为起点进入自由回放；已有回放上下文时，每次按键推进下一根 K 线。焦点位于输入框、文本域或下拉框时不得触发该快捷键。

### 3.4 画图

- 画完一个图形后，工具必须自动回到选择指针。
- **行情复盘**画图通过 `/api/chart/drawings` 持久化，写入 `chart_drawings`。
- **仓位复盘**画图通过 `/api/position-review/drawings` 按 `(venue, position_id)` 持久化，写入 `position_drawings`；list **不按周期过滤**，切换 15m/1h 仍加载该仓位全部画线。
- **Bit浪浪实盘分析**画图通过 `/api/bitlang-review/drawings` 按交割单 `trade_id` 持久化，写入 `bitlang_trade_drawings`；list **不按周期过滤**，切换周期仍加载该笔全部画线；切换交易后加载对应交易的画线。后端不要求交割单行存在于 SQLite。
- 三套画图表禁止混写。前端封装分别走 `drawing-api.ts` / `position-review-api.ts` / `bitlang-review-api.ts`。
- 视频发布时间标记和交易/仓位开平仓标记属于 System Marker，禁止写入任何 drawings 表。
- 不要把 Bit浪浪交割单、仓位复盘同步仓位与模拟交易混为一类。

### 3.5 Bit浪浪交割单

- 浏览器读取 `web/public/bitlang-trades.json`，运行时不直接读取 Excel。
- 原始工作簿只读；重新导入使用 `scripts/import_bitlang_trades.py`。
- `BTC-USDT-SWAP` 等交割单名称只在适配层转换为 Bybit Symbol，例如 `BTCUSDT`。
- 左侧筛选、排序和分页不能修改原始交易数组。
- 持仓时间筛选口径是：`holdingMinutes` **严格大于**用户输入的分钟数。
- 工作台内含 **K 线复盘**与**交割单看板**两个视图，不要再加第五个顶部入口。看板日记跳转到某笔交易时，应切回 K 线并定位该交易。
- 可编辑备注与标签走独立 SQLite 表与 `/api/bitlang-review`，按交割单 `id`（导入时 sha256）持久化；**不得覆盖** JSON 里的 `sourceNote`，也不得写入 `position_notes` / `position_tags` / `position_tag_map`。
- `GET /api/bitlang-review` 须在同一只读事务中组装 notes / tags / tagMap；后端不读取交割单 JSON。
- 前端封装在 `web/src/api/bitlang-review-api.ts`，不要在组件内直接拼请求。
- 画图按交割单 `id` 持久化到 `bitlang_trade_drawings`；刷新后仍在，切换周期保留，切换交易隔离。禁止写入 `chart_drawings` / `position_drawings`。
- 看板时间窗按快照最晚开仓时间裁切，不要用 `Date.now()`。

### 3.6 仓位复盘（Bitget UTA）

- 第四个顶部入口由 `AppShell.tsx` 的 `positions` tab 管理；默认入口仍是顺序学习。
- 仓位复盘内含 **K 线复盘**与**账户看板**两个视图，不要再加第五个顶部入口。看板日记跳转到某笔仓位时，应切回 K 线并定位该仓位。
- 仅支持 **Bitget UTA** 只读同步；CCXT 调用必须带 `uta=True`。不要实现下单、改单、撤单或任何交易写接口。
- 密钥经 Fernet 加密后写入 `app_settings`；对称密钥文件为 `.run/credential-key`。GET 接口只返回 `configured: true/false`，**永不回传明文密钥**。
- 同步为手动触发（`POST /api/position-review/sync`），默认拉取约 90 天已平仓 + 当前持仓；不要改成后台轮询或自动实盘跟单。
- 并发同步：已有同步进行中时再次 `POST /api/position-review/sync` 返回 **409**，前端提示稍后再试；不要改成排队自动重试或后台轮询。
- `GET /api/position-review` 须在同一只读事务中组装 positions / tags / fills / balance / `configured`。
- `GET /api/position-review/cache-audit` 只读对照 `venue_market_cache_ranges` 与实际 K 线连续性；禁止自动改写缓存范围。
- 仓位按 `(venue, position_id)` upsert；备注与标签不因同步被覆盖。开仓合成 ID 在平仓后若能按 symbol/side/开仓时间匹配，应迁移备注/标签到交易所 `positionId`。
- 前端仓位复盘 API 封装在 `web/src/api/position-review-api.ts`，不要在组件内直接拼私有账户请求。
- 备注、标签、仓位-标签映射走 `/api/position-review/notes|tags|position-tags`；筛选与排序只作用于列表视图，不修改库内原始仓位行。
- 领域对象需带 `venue`；图表 symbol 使用紧凑 USDT 形式（如 `BTCUSDT`、`INTCUSDT`）。
- 仓位画图走 `/api/position-review/drawings`，写入 `position_drawings`；禁止写入 `chart_drawings` / `bitlang_trade_drawings`。
- v1 不做 CSV 导入、AI 分析或多交易所一夜切换；扩展其他交易所前必须单独评估 CCXT 能力与鉴权差异。

## 4. 数据安全

- 不删除或覆盖 `tiabtc-review.sqlite`。
- 不批量修改历史 K 线、画图、学习状态、模拟交易或已同步仓位复盘数据。
- 数据库变更必须先说明表结构、兼容方式、回滚方案和历史数据影响。
- 仓位复盘相关新表（仅增量，不改既有 Bybit 行情表语义）：
  - `exchange_positions`、`position_notes`、`position_tags`、`position_tag_map`、`position_fills`、`position_drawings`
  - `venue_market_candles`、`venue_market_cache_ranges`
- bit浪浪本机备注/标签/画图相关新表（仅增量，不改交割单 JSON 与仓位复盘表语义）：
  - `bitlang_trade_notes`、`bitlang_trade_tags`、`bitlang_trade_tag_map`、`bitlang_trade_drawings`
  - 回滚：`DROP` 这四张表即可；交割单快照与仓位数据不受影响
- 已退役的行情复盘 OI/CVD 历史兼容表（不改既有 Bybit 行情表语义，不主动删除）：
  - `market_oi_15m`、`market_oi_15m_cache_ranges`
  - 旧表 `market_oi_1h`、`market_oi_1h_cache_ranges` 保留不删
- 不执行生产数据库写操作。
- 不将账号、密码、Token、API Key、Secret、Passphrase、代理地址或连接串写入仓库、文档示例或提交信息。
- `.run/credential-key` 与加密后的交易所密钥只存本机；用户若在聊天中粘贴过密钥，应提醒其在交易所侧轮换。
- 不覆盖用户未确认的工作区改动，不执行 `git reset --hard` 或类似破坏性命令。
- 清理文件前先通过引用搜索确认其不属于当前运行链路。

## 5. 修改原则

- 保持最小变更，沿用现有目录、组件、API 封装和 CSS Token。
- 不创建新的独立入口；导航统一由 `AppShell.tsx` 管理。
- 公共 Bybit 行情请求走 `web/src/api/market-api.ts`；仓位复盘走 `web/src/api/position-review-api.ts`；bit浪浪备注/标签/画图走 `web/src/api/bitlang-review-api.ts`。不要在组件内散落新的行情或账户请求。
- 不为一次修复引入大型框架或新的状态管理库。
- 用户提示走全局 toast / 确认框（`web/src/ui/feedback/`）；确认框打开时给 `.app-shell` 加 `inert`。不要回退到原生 `alert` / `confirm`。
- 筛选、排序、分页、周期、当前选中项和工作台内部视图等非敏感界面偏好，应通过 `web/src/ui/persistence/local-ui-state.ts` 做容错的本机记忆；顶部默认入口仍是顺序学习。禁止记忆 API 密钥、笔记草稿、弹窗、错误、加载态或其它短暂操作状态。
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
| `study_server.py` | API、SQLite 表、行情缓存、画图、模拟交易与仓位复盘持久化 |
| `market_data_provider.py` | CCXT Bybit 行情适配、代理、限频与永续目录 |
| `bitget_position_provider.py` | CCXT Bitget UTA 只读仓位/余额与回退 K 线 |
| `web/src/app/AppShell.tsx` | 四个工作台导航、主题和连接状态 |
| `web/src/chart/ChartCanvas.tsx` | K 线、成交量、视口、十字线和边界加载 |
| `web/src/chart/chart-time.ts` | 毫秒/秒边界转换和北京时间格式化 |
| `web/src/features/review-workspace/ChartWorkspace.tsx` | 行情与视频复盘组合 |
| `web/src/features/review-workspace/useDrawingWorkspace.ts` | server/memory/position/bitlang 四种画图模式 |
| `web/src/features/bitlang/BitlangTradeWorkspace.tsx` | 交割单列表、筛选、K 线/看板切换和按交易持久化画图 |
| `web/src/features/bitlang/BitlangTradeChart.tsx` | 交割单图表、复制图表、按交易持久化画图 |
| `web/src/features/bitlang/BitlangTradePanel.tsx` | 复盘详情：概览、原始备注、本机笔记与标签 |
| `web/src/features/bitlang/BitlangDashboardWorkspace.tsx` | 交割单看板；日记跳转须切回 K 线并定位交易 |
| `web/src/features/position-review/PositionReviewWorkspace.tsx` | 仓位复盘编排：同步、筛选、K 线/看板切换 |
| `web/src/features/position-review/PositionReviewChart.tsx` | 仓位图表、按仓位持久化画图、来源与截断提示 |
| `web/src/features/position-review/PositionReviewPanel.tsx` | 密钥、筛选、列表、备注标签 |
| `web/src/features/position-dashboard/PositionDashboardWorkspace.tsx` | 账户看板；日记跳转须切回 K 线并定位仓位 |
| `web/src/api/market-api.ts` | 公共 Bybit 行情请求 |
| `web/src/api/position-review-api.ts` | 仓位复盘 API 封装 |
| `web/src/api/bitlang-review-api.ts` | bit浪浪本机备注/标签/画图 API 封装 |
| `web/src/api/candle-window-cache.ts` | 窗口 K 线分片 LRU |
| `web/src/ui/persistence/local-ui-state.ts` | 非敏感界面偏好的 localStorage 容错读写与类型校验 |
| `web/src/ui/feedback/GlobalConfirmDialog.tsx` | 全局确认框 |
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

1. 四个顶部入口均可进入，默认打开顺序学习。
2. 亮色/暗色主题可切换。
3. `1m/5m/15m/1h/4h/1d/1w` 能切换。
4. K 线与成交量副图同时显示。
5. 缩放、拖动和左右延展不跳动。
6. 十字线时间为北京时间完整格式。
7. Bit浪浪点击交易后开平仓区间居中。
8. Bit浪浪画图可保存；刷新后仍在；切周期仍在；切交易后加载该笔画图。
9. 行情复盘持久化画图仍可正常读取和保存。
10. 仓位复盘：保存只读密钥后可同步列表；点击仓位后开平仓区间居中；切换周期后重新定位。
11. 仓位复盘：备注与标签可保存；画图按仓位持久化，刷新后仍在，切周期仍在；主流合约 K 线来源显示 Bybit，Bybit 无合约时应回退 Bitget。
12. GET `/api/position-review` 与相关接口响应中不得出现明文 API Key/Secret/Passphrase。
13. 控制台没有未处理异常，接口错误能显示可理解的信息。
14. 行情复盘不存在「OI / CVD」开关或副图；页面不请求 `/api/chart/flow`，服务启动时不进行 OI/CVD 预热。
15. 仓位复盘账户看板可进入；日记跳转切回 K 线并居中。
16. 过长 1m 仓位出现截断提示，不一次拉全历史。
17. 同步进行中再次同步显示冲突（409），页面不被打挂。
18. 密钥面板「审计 Bitget 回退缓存」只读、不改库。
19. 全局确认框打开时后台不可操作。
20. bit浪浪：点击交易后开平仓区间居中；复盘详情抽屉可开关；复制图表可用；画图按交易持久化，刷新后仍在。
21. bit浪浪：本机备注/标签可保存且不覆盖交割单原始备注；看板可进入；日记跳转切回 K 线并居中。
22. 列表翻页、筛选、排序、周期和内部视图在刷新/重启后恢复；失效的交易对、标签或越界页码安全回退，且本机存储中不出现密钥和编辑草稿。
23. 行情复盘双击切入自由复盘后，刷新仍保留回放起点、当前揭示时间和速度（自动播放按暂停恢复），未来 K 线继续隐藏；退出自由回放后刷新不得重新进入回放。
