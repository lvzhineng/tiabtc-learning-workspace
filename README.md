# 观烛复盘

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个本地运行的交易学习、行情复盘、实盘交割单分析和仓位复盘工作台。本项目以 **MIT** 许可开源，不锁源、不做功能付费墙。

项目将顺序学习、行情复盘、全球市场、Bit浪浪交割单分析和仓位复盘整合为一个 React 应用，默认入口仍为顺序学习。加密货币行情复盘 / Bit浪浪 / 顺序学习进复盘的 K 线通过 CCXT 获取 Bybit USDT 永续合约数据。全球市场独立读取 Gate 公共 TradFi 行情，提供黄金、白银、纳斯达克100、标普500和日经225。仓位复盘中 `BTCUSDT` / `ETHUSDT` 走同一套 Bybit 缓存；其余合约走该仓位所属交易所（Bitget 或 Gate），写入独立表 `venue_market_*`，本所失败且 Bybit 目录有该合约时再回退 Bybit。本地使用 SQLite 做行情与仓位缓存。

## 支持作者

作者通过交易所邀请链接获得交易手续费返佣（Gate 最高约 80%、Bitget 最高约 60%，以交易所当时规则为准）。**返佣比例只出现在本说明里，不会写入交易、同步或 K 线逻辑。**

通过邀请链接注册时，作者可能获得手续费返佣；你可以在应用右上角「设置」中自行改邀请码，Fork 也可以覆盖默认链接。

仓库默认使用作者的邀请深度链接：

- Gate：`https://www.gatewebsite.app/share/VFHFAFJW`
- Bitget：`https://partner.bitget.cafe/bg/19qdpd2n`

覆盖方式（优先级从高到低：设置页保存的值 → 环境变量 → `config.local.json` → `config.defaults.json`）：

1. 在工作台右上角 **设置** 中编辑 Gate / Bitget 邀请链接。
2. 复制 `config.local.example.json` 为 `config.local.json`（已 gitignore），改成你自己的邀请深度链接。
3. 或设置环境变量 `TIA_GATE_INVITE_URL`、`TIA_BITGET_INVITE_URL`。

默认已填入上述作者邀请链接。在设置中改掉或用 `config.local.json` / 环境变量覆盖后，连接界面的注册 CTA 会跟着变。

## 功能

### 顺序学习

- 粘贴任意 YouTube 频道或播放列表，导入为学习清单；按发布时间排序，并从发布时间打开 BTC 行情复盘。
- TiaBTC 公开频道是一键填入的 **示例模板**，不是唯一目录。
- 按学习状态、日期和关键词筛选；保存未学习、学习中、已学习状态。
- 同一来源再次刷新为增量合并：已有条目的标题与发布时间不会被覆盖。

### 行情复盘

- 支持 `1m`、`5m`、`15m`、`1h`、`4h`、`1d`、`1w`。
- 显示 K 线和成交量副图。
- 支持自由回放和逐根揭示。
- 支持多种画图工具、撤销、重做、锁定和磁吸；按住 Ctrl 临时开启磁吸，松开后恢复原状态。
- 支持持久化画图和模拟交易。
- 图表向左右边界移动时自动延展历史行情。

所有复盘图表的「交易时段」可多选亚盘（东京）、欧盘（伦敦）、美盘（纽约），使用不同淡色背景；选择在本机记忆，旧美盘开关自动兼容。按三地现货常规时段参考标注，欧美夏令时自动转换为北京时间；亚盘保留午休，节假日未修正，日线/周线不显示时段。

### 复盘档案

- 行情复盘与全球市场工具栏内新增 **复盘档案**，不增加顶部入口。开始新的自由复盘时自动建立独立档案；已有公共画线可点 **保存本次复盘** 复制到一份档案，原画线继续保留。
- 共享 K 线图提供 **EMA 20 / 60 / 120**（收盘价指数移动平均线）。图表左侧图例显示十字线对应数值，眼睛按钮独立显隐，支持全部显示/隐藏及折叠列表；偏好按行情、全球市场、仓位复盘、Bit浪浪分别保存在本机。图例会避让悬浮画图工具栏，显隐不重建图表或改变时间视口；回放只计算已揭示行情。
- 美股单日复盘使用此前交易日的同周期常规时段行情预热 EMA，目标120根、最多回查10个交易时段，兼容提前收盘。预热历史不扩展可见时间轴，不使用盘前盘后或当日未来行情；不足或失败会提示并可重试。
- 档案保存品种、周期、复盘起点与当前游标、播放速度、可视跨度和图表显示偏好。重新打开时按暂停状态恢复，后续行情继续隐藏。
- 档案中的趋势线、文字等保存为可编辑对象，自动持久化；跨周期保留，支持继续绘制、移动、修改、删除及撤销/重做。不同档案的画线隔离。
- 可修改档案名称，并从 **打开已有复盘** 选择档案；列表显示当前市场最近 200 份档案。**新建复盘** 使用独立的空白画线，**公共画线（历史数据）** 可返回原有画线。
- 状态位置自动保存，也可点击 **立即保存**。切换档案前等待当前画图与状态保存；保存失败会提示并保留当前档案。
- 数据只新增 `review_sessions` 表，不迁移旧画图、交易、仓位或行情数据，也不保存密钥。回滚代码后旧入口仍可使用，新档案保留在独立表中。后端 API 版本为 16，更新后重新运行现有启动脚本以加载新版后端。

针对性验证（不编译、不打包）：后端执行 `python -m unittest test_review_sessions.py -v`，仅使用临时 SQLite 和测试结束即关闭的本地 HTTP 服务；前端在现有 3000 页面运行时执行 `node --test web/tests/review-sessions.check.cjs`，使用隔离浏览器上下文和模拟接口，不写本机数据。

### 全球市场

- 独立顶部「全球市场」入口（`?tab=cfd`），与加密永续分开；默认黄金 `XAUUSD`、1h。数据来源显示为「Gate CFD」，内部路由、接口和缓存仍使用 `cfd`。
- 可使用 `powershell -File .\start-workspace.ps1 -Page cfd` 直接打开全球市场。
- 从 Gate 公共 `/tradfi/symbols` 与 `/tradfi/symbols/categories` 动态读取金属、指数、外汇、大宗商品和股票及 ETF 类 CFD。品种下拉支持分类、跨分类代码/名称搜索、星标收藏与「自选」；收藏、分类与变体开关在本机记忆。默认隐藏杠杆档位变体，可勾选显示；休市品种仍可复盘。
- 品种目录缓存一小时，支持手动刷新（最短间隔60秒）。本机目录快照为 `.run/cfd-symbols.json`；离线或请求失败时使用已有目录，初次无快照时回退原有五个常用品种。历史品种继续保留缓存、画线与复盘档案访问。此更新无需数据库结构迁移；回滚代码即可，已有行情和画线不受影响。
- 使用 Gate 公共 `/tradfi/symbols/{symbol}/klines` 接口，无需账户密钥；支持七个周期，5m 优先原生读取，仅在明确不支持时从1m聚合。
- 支持自由回放、快捷键、持久化画图及复制图表；品种、周期、视口和回放进度独立记忆，刷新后自动播放以暂停状态恢复。
- Gate 未提供成交量，所以不显示成交量副图或读数；首期不提供模拟交易。休市不补造 K 线，回放推进到下一根实际行情。
- 后端按最多500根分页，单次响应最多3000根；历史范围以 Gate 实际可提供的数据为准。离线模式只读已有 CFD 缓存。
- GC 入口及样本自动下载已退役；已有 `gc_candles` 和 GC 画线保留，不迁移成 CFD。

全球市场只增量新增 `cfd_candles`（品种、周期、毫秒时间、OHLC）、`cfd_cache_ranges`（含休市空区间的查询范围及刷新时间）、`cfd_drawings`（按品种隔离、跨周期读取的画图）。不修改已有行情、画图或仓位表。回滚可停用全球市场入口与 CFD 接口，备份后单独移除这三张表；其他历史数据不受影响。

### bit浪浪实盘分析

- 左侧展示导入的历史交割单，右侧展示对应 K 线。
- 显示开仓、平仓标记和交易指标。
- 支持交易对、方向、盈亏、持仓时间筛选和排序。
- 点击交易或切换周期后，交易区间自动回到图表中央。
- 画图按交割单持久化；刷新后仍在，切换周期保留，切换交易后加载该笔画图。

### 仓位复盘

- 日常侧栏仅保留同步、账户管理、搜索、筛选与仓位列表。连接配置统一收进「账户管理」抽屉，Exness / Bitget / Gate 永续 / Gate CFD 按需展开；本机文件检查与只读缓存审计也在抽屉内。上次同步时间放在同步按钮提示中，失败信息以简短提示展开查看；关闭抽屉清空未保存的密钥草稿。
- **Exness 文件导入（兼容入口）**：未连接 API 时，可把同一账户的 Exness 交易记录 CSV 放入项目相对目录 `data/exness`。后端启动时和运行期间每30秒增量检查，也可点击「检查文件」；连接 API 后使用统一同步，停止自动扫描文件。已导入数据仍保留本机 SQLite，原始文件只读。
- CSV 需包含 `ticket`、`opening_time_utc`、`closing_time_utc`、`type`、`lots`、`original_position_size`、`symbol`、`opening_price`、`closing_price`、`profit`；UTF-8 编码，时间按UTC解析、界面按北京时间显示。同一 ticket 的分批平仓合并为一笔仓位并保留每次平仓标记；重叠导出不会重复新增，备注、标签和画线保留。一个目录仅放一个账户，删除原始文件不会删除已导入记录。
- **Exness API 同步**：打开「账户管理 → Exness」，填写交易账户编号、只读 API Key、Ed25519 私钥和 API 管理页的官方网关主机名。保存后点击统一「同步」，读取 API 允许历史范围内的成交与当前持仓，无需继续导出 CSV。历史按平台限制分段、分页读取，后续增量去重；首次历史较多时按提示再次点击同步继续，不自动重试。密钥本机加密保存，接口不回传明文。
- Exness 成交时间兼容任意小数秒精度（包括 Python 3.9 不直接接受的5位小数秒）。只读请求复用 HTTPS 连接；签名被明确拒绝为 `AUTH_INVALID_SIGNATURE` 时，最多按 HTTPS 响应时间校准一次，不改系统时钟。账户接入点拒绝 Key 时，最多重新发现一次接入点，并验证同一账户后才重发读取；网关 Key 错误、权限错误和429均停止，不循环重试。部分账户同步失败的原因持续显示在仓位侧栏，不将部分失败提示成全部完成。失败缓存不会因频繁点击续期，未取得交易时段K线时不展示不相关的旧缓存。
- 原生1m/5m/15m/1h/4h/1d/1w行情直接读取官方成品K线，按实际品种请求，不再限制为 BTC/黄金。Exness 暂不提供的指数 USTEC（纳指）、US500、JP225 使用明确映射的 Gate CFD 参考行情，页面持续标注来源及报价差异，不改变真实成交价和利润。原生图标注「Exness · Bid」，所有 Exness 图隐藏成交量。旧BTCUSDT/NAS100内部别名继续兼容已有仓位与画线。
- Exness 行情只补交易附近和指标预热区间，原生写入 `exness_market_candles` / `exness_market_cache_ranges`，按账户、品种、周期隔离；指数参考行情复用 Gate 独立 CFD 缓存。单次最多3000根，活动图最多12000根，休市不造K线。Exness 外部请求全部为签名 GET，不包含任何下单、改单、撤单接口。
- 看板默认「全部平台 / 全部历史」，统一展示交易日记、日历和交易数量。按约定统计口径，明确为 USD 的 Exness 交易及账户权益按 **1 USD = 1 USDT** 与 USDT 合并；总盈亏、盈亏曲线、周期对比、日历、标签和品种统计使用相同分组。原始交易、明细和账户管理仍显示真实币种，不改数据库或原始金额；提示说明合并口径。Gate CFD 的 USD、Exness 其它币种及未标注币种文件利润继续单列。API 同步记录带真实账户币种；旧 CSV 只有严格核对仓位后才关联，未确认的记录保留文件原值，不擅自补美元或推算 ROI/杠杆。回滚前端统计代码即可恢复原币种分组，无数据迁移。
- 本地仅增量新增 `exness_api_deals`（账户范围/成交ID去重、原生仓位ID、事件时间和成交内容）与 `exness_api_positions`（原生仓位到本机仓位的映射及币种）。不删除旧文件、仓位、备注、标签或画线；API 已关联仓位不被后续文件扫描覆盖。连接后停止自动扫描文件，旧文件导入作为未连接时的兼容入口。回滚停用 API 同步代码即可，保留数据及辅助表，不需回写历史数据。
- 文件指纹与平仓明细分别保存在新增 `exness_import_files` / `exness_trade_legs` 表，仓位沿用 `exchange_positions` 的 `exness` 来源。原始 CSV 只读且忽略 Git。格式错误或累计平仓手数冲突时整文件回滚并提示；CSV没有成交ID，历史价格/时间更正需人工核对。停用导入即可回滚功能，已有记录保留。更新代码后重新运行一键启动加载新版后端。

- 使用本机保存的 Bitget UTA / Gate **只读**密钥，手动同步约 90 天已平仓与当前持仓；两所仓位汇聚在同一列表。
- **Gate CFD / TradFi 仓位**：在「仓位复盘 → 账户管理 → Gate CFD / TradFi」点击「使用已保存的 Gate 密钥连接 CFD」，或单独填写具有 CFD 读取权限的 Gate API Key / Secret，再点击「同步」。可只连接 CFD，也可与永续同时连接；密钥分别加密保存，复用操作不向浏览器返回明文。须先在 Gate 主账户开通 CFD，工作台仅调用只读 GET 接口。账户看板需选择「Gate CFD · USD」。代码更新后通过一键启动重新加载后端。
- CFD 历史接口最多追溯最近一个月，已同步历史持续保留；列表可单独筛选 Gate CFD。CFD 数量单位为手，账户权益与盈亏按 USD 展示；账户看板可切换「加密永续 / Gate CFD」，两种货币分别统计。CFD 保证金与手数无法套用永续公式，因此不推算 ROI 或历史杠杆。
- CFD 仓位 K 线走 Gate 公共 TradFi 行情，可读取已同步仓位的品种，使用 `cfd_candles` / `cfd_cache_ranges`；无成交量，不回退 Bybit。显示开平仓摘要标记，不合成分批成交明细。备注、标签与画线按 `(gate-cfd, position_id)` 隔离保存，画线仍使用 `position_drawings`，不与全球市场画线混写。
- 本功能无需表结构迁移；密钥与 USD 权益使用新增 `app_settings` 键，CFD 仓位使用既有仓位表的 `venue=gate-cfd`。回滚代码后新记录保留且旧账户数据不变；本机数据库、密钥文件均应保留。
- 左侧筛选仓位列表，右侧显示对应 K 线、开平仓标记；支持备注与标签。
- 内含 **K 线复盘**与**账户看板**两个视图；看板日记可跳回对应仓位并居中。
- 画图按仓位持久化；刷新后仍在，切换周期保留，切换仓位后加载该仓位画图。
- API Key / Secret / Passphrase 经本机加密后保存。接口只返回是否已配置，**永不回传明文密钥**。

## 环境要求

- Windows 10/11
- Python 3.10 或更高版本
- Node.js 20 LTS（推荐）
- npm
- 能够访问 Bybit；仓位复盘还需能访问已配置的 Bitget / Gate。如系统配置了 `HTTP_PROXY` 或 `HTTPS_PROXY`，CCXT 会自动使用

## 一键启动

双击项目根目录中的：

```text
start-workspace.cmd
```

首次启动会自动：

1. 检查 Python 和 npm。
2. 安装 `requirements.txt` 中的 CCXT 与 cryptography。
3. 在缺少 `web/node_modules` 时执行 `npm install`。
4. 启动 Python API 服务。
5. 启动 Vite 前端。
6. 打开默认的顺序学习工作台。

启动窗口需要保持打开。关闭窗口或按 `Ctrl+C`，会停止由本次脚本启动的服务。

## 指定启动页面

在 PowerShell 中执行：

```powershell
.\start-workspace.ps1 -Page learning
.\start-workspace.ps1 -Page review
.\start-workspace.ps1 -Page bitlang
.\start-workspace.ps1 -Page positions
.\start-workspace.ps1 -Page dashboard
```

不自动打开浏览器：

```powershell
.\start-workspace.ps1 -Page bitlang -NoBrowser
```

页面地址：

| 工作台 | 地址 |
| --- | --- |
| 顺序学习 | `http://127.0.0.1:3000/` |
| 行情复盘 | `http://127.0.0.1:3000/?tab=review` |
| bit浪浪实盘分析 | `http://127.0.0.1:3000/?tab=bitlang` |
| 仓位复盘 | `http://127.0.0.1:3000/?tab=positions` |
| 账户看板 | `http://127.0.0.1:3000/?tab=positions&view=dashboard` |
| 后端健康检查 | `http://127.0.0.1:8765/api/health` |

## 数据流

```text
React/Vite
   └─ /api 请求
      └─ Python API
         ├─ 优先读取 tiabtc-review.sqlite
         ├─ 缺 K 线时通过 CCXT 请求 Bybit（主源，写入 market_candles）
         └─ 仓位复盘 K 线：
            ├─ BTCUSDT / ETHUSDT 走 Bybit（market_candles）
            ├─ 其余合约走仓位所属交易所（Bitget / Gate）
            │    └─ 写入 venue_market_candles，不与 Bybit 缓存混写
            └─ 本所失败且 Bybit 目录有该合约时，回退 Bybit 并在 warning 中说明
```

加密货币行情复盘、Bit浪浪与顺序学习进复盘共用同一套 Bybit K 线缓存（`market_candles`）。CFD 行情和查询范围分别写入 `cfd_candles` / `cfd_cache_ranges`，画图写入 `cfd_drawings`。旧 `gc_candles` 保留但不再运行时读写。仓位复盘仅对 BTC/ETH 使用 Bybit 缓存；其它合约写入 `venue_market_candles` / `venue_market_cache_ranges`。各入口的展示窗口和业务标记不同，但相同 Symbol、周期和时间对应的 Bybit 行情来自同一张表。

## 主要数据文件

| 文件 | 用途 | 是否可直接删除 |
| --- | --- | --- |
| `tiabtc-review.sqlite` | K 线缓存、画图、模拟交易、仓位复盘，以及加密后的交易所密钥 | 否 |
| `.run/credential-key` | 本机 Fernet 对称密钥，用于加密 Bitget / Gate 只读密钥；已 gitignore | 否，且勿提交 |
| `learning-state.json` | 视频学习状态 | 否 |
| `web/public/videos.json` | 浏览器读取的视频列表快照 | 可重新生成 |
| `video-catalog.csv` | 导入/刷新后的工作副本（已 gitignore）；未导入时回退读取 Tia 示例 CSV | 可重新生成 |
| `video-source.json` | 当前学习清单来源（频道/播放列表，已 gitignore） | 可删除后回退示例模板 |
| `config.defaults.json` | 仓库内邀请链接默认值（作者 Gate / Bitget 深度链接） | 否 |
| `config.local.json` | 本机覆盖邀请链接；复制自 `config.local.example.json` | 可删除 |
| `web/public/bitlang-trades.json` | 浏览器读取的交割单快照 | 可从原始 Excel 重新生成 |
| `TiaBTC_公开视频清单*.csv` | 随仓库提供的 Tia 示例清单（导入其它来源时不会改写） | 否 |

不要通过浏览器访问 8765 端口下的本地文件。后端只提供 `/api/*` 接口。

## 更新视频列表

浏览器只读 `web/public/videos.json`。工作副本是根目录 `video-catalog.csv`（首次导入/刷新时从 Tia 示例 CSV 生成）。上游可以是任意公开 YouTube **频道**或**播放列表**。

工作台内导入（推荐）：打开顺序学习页，把频道或播放列表 URL 粘贴到输入框后点 **导入**。**示例模板 / Tia** 只负责填入已知的 TiaBTC 频道地址，不是唯一入口。同一来源点 **刷新当前来源** 会增量拉取新视频。已有条目的标题与发布时间不会被覆盖；换来源会重建清单（不在新来源中的条目移出，学习状态仍按视频 ID 保留）。

也可以在项目根目录执行：

```powershell
python scripts/refresh_videos.py
python scripts/refresh_videos.py --template tia
python scripts/refresh_videos.py --url "https://www.youtube.com/@someone"
python scripts/refresh_videos.py --url "https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID"
```

或在 `web` 目录：

```powershell
npm run refresh:videos
```

`npm run refresh:videos` 等价于无参数的 `python scripts/refresh_videos.py`（增量刷新当前来源；若尚无 `video-source.json` 则使用 Tia 示例频道）。带 URL 的导入请用上面的 `python scripts/refresh_videos.py --url ...`。

若只改了 CSV、不需要访问 YouTube，可只重建 JSON：

```powershell
cd web
npm run build:videos
```

也可以从项目根目录直接执行：

```powershell
python web/scripts/build-videos-json.py
```

生成结果为 `web/public/videos.json`。刷新依赖访问 YouTube；如系统配置了 `HTTP_PROXY` / `HTTPS_PROXY`，脚本会跟随系统代理。

## 更新 Bit浪浪交割单

导入脚本依赖 `openpyxl`，仅在重新生成交割单快照时需要：

```powershell
python -m pip install openpyxl
python scripts/import_bitlang_trades.py
```

默认从相邻目录 `BitLanglangReview` 读取原始工作簿，并生成：

```text
web/public/bitlang-trades.json
```

也可以显式指定源文件和目标文件：

```powershell
python scripts/import_bitlang_trades.py "D:\path\trades.xlsx" "web\public\bitlang-trades.json"
```

原始 Excel 只读，运行时页面不会直接打开或修改它。

## 手动开发启动

后端：

```powershell
python study_server.py
```

前端：

```powershell
cd web
npm install
npm run dev -- --host 127.0.0.1 --port 3000
```

正常使用建议优先运行 `start-workspace.cmd`，避免遗漏后端、端口和代理检查。

## 连续复盘流程

- 在 bit浪浪或仓位复盘中点击「待复盘」，筛出同时没有本机笔记、没有标签的记录；其它筛选条件继续生效。保存笔记或添加标签后，该记录会退出此列表。
- 选择记录后查看开平仓区间，添加画线、笔记和标签；「导出复盘卡片」下载包含当前图表、已保存笔记和标签的离线 HTML。bit浪浪卡片另外保留交割单原始备注，未保存的编辑草稿不会导出。
- 行情复盘和全球市场可添加时间书签，从下拉列表跳转后进入自由回放；两种市场的书签隔离，每种最多 100 个。书签跳转会暂停在选定时间，未来行情继续隐藏。
- 两套交易看板选择近 7 / 30 / 90 天后，可对比前一个等长时段的样本数、盈亏和胜率。交易对、方向和标签筛选保持一致；bit浪浪以快照最晚开仓时间为截止时间。

活动图表最多保留 12,000 根 K 线。向任一方向延展会淘汰远端数据，保留的可见时间和缩放不跳动；回放退到已淘汰的历史边界会重新加载。数据库历史行情和画线不因内存淘汰而删除，单次响应的 3,000 根上限继续生效。

设置页的「性能诊断」可查看最近请求、行情合并、仓位读取和成交归属的耗时及数量。前后端各最多保留 200 条内存记录，不记录请求参数、密钥或笔记，刷新页面 / 重启服务后对应记录清空。

## 回归与性能检查

```powershell
# 项目根目录：仅使用临时测试库
python -m unittest test_study_server -q
python scripts/benchmark_review.py --baseline-ref 9b7bd45c40358ebc72b06d8d71325e2484b31a95

cd web
npm ci
npm run typecheck
npm test
```

浏览器回归默认使用本机 Chrome。只有 Edge 时可先设置 `$env:PLAYWRIGHT_CHANNEL = 'msedge'`。测试自动启动并关闭 3011 端口的 Vite，所有 API 与快照由夹具拦截，不访问交易所或本机账户数据库；3011 需要空闲。`npm run test:logic` 只执行逻辑回归。长回放测试的堆内存采样保存在 `web/test-results/` 中。

性能口径、基准结果和人工回归边界见 [复盘性能记录](docs/review-performance.md)。

## 日志

一键启动产生的日志位于：

```text
.run/backend.out.log
.run/backend.err.log
.run/frontend.out.log
.run/frontend.err.log
```

## 常见问题

### 页面显示“后端通信异常”

确认：

- 8765 端口没有被其他程序占用。
- `.run/backend.err.log` 中没有 Python 异常。
- `http://127.0.0.1:8765/api/health` 可以访问。

### Bybit K 线请求失败

确认：

- 网络能够访问 Bybit。
- 系统代理环境变量配置正确。
- Python 环境中可以执行 `import ccxt`。
- 没有多个程序高频请求同一个交易所接口。

已经下载的 K 线会从 SQLite 读取；缺失区间仍需要网络。

### 切换周期时一直加载

先查看后端错误日志。如果网络正常，刷新页面后重新选择交易。Bit浪浪的长持仓交易在 1 分钟周期可能需要读取较多 K 线，首次加载会比高周期慢。

### 画图弹出保存失败

- 行情复盘画图会写入数据库，应检查后端日志和 Symbol 配置。
- Bit浪浪画图按交割单写入 `bitlang_trade_drawings`；仓位复盘画图按仓位写入 `position_drawings`。刷新后应仍在，切换周期保留。
- 三套画图表不会混写。确认请求是否打到对应接口。

### 仓位复盘同步失败或提示冲突

- GET `/api/position-review` 只返回 `configured` 与 `venues.bitget/gate`，看不到明文密钥是正常的。
- 同步进行中再次点击会返回 409，稍后再试即可；不要改成后台轮询。
- 确认密钥是 Bitget UTA 或 Gate **只读**权限，并查看 `.run/backend.err.log`。
- `.run/credential-key` 与加密后的密钥只存在本机，不要提交到 Git。

### 刷新或导入视频清单失败

- 确认能访问 YouTube；代理环境变量与行情请求相同。
- 刷新进行中再次点击会返回 409，稍后再试。
- 也可以在项目根目录运行 `python scripts/refresh_videos.py --url "..."`，查看终端报错。
- 只改 CSV、不访问 YouTube 时，用 `npm run build:videos` 重建 `videos.json`。
- 换来源会写入 `video-catalog.csv`，不会改仓库里的 Tia 示例 CSV。

### 端口被占用

默认端口：

- 前端：3000
- 后端：8765

启动脚本只会自动替换属于当前项目的旧后端，不会终止其他程序。

## 工程说明

- 前端：React 18、TypeScript、Vite、Lightweight Charts 4。
- 后端：Python 标准库 HTTP Server、SQLite。
- 在线行情：CCXT / Bybit USDT Perpetual（主源）。仓位复盘私有账户：CCXT / Bitget UTA（`uta=True`）与 CCXT / Gate USDT 永续。非 BTC/ETH 的仓位 K 线走所属交易所的 `venue_market_*` 表。
- 本地加密：`cryptography`（Fernet）；密钥材料只存 `.run/` 与 SQLite，不入库。
- 时间：内部 Unix 毫秒，界面按 `Asia/Shanghai` 显示。
- 主题：支持亮色和暗色，本地记忆用户选择。
- 许可：MIT，见 [LICENSE](LICENSE)。

参与修改前请先阅读 [AGENTS.md](AGENTS.md)，其中记录了数据安全、图表交互和持久化边界。
