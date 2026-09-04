# TiaBTC Learning Workspace

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个本地运行的交易学习、行情复盘、实盘交割单分析和仓位复盘工作台。本项目以 **MIT** 许可开源，不锁源、不做功能付费墙。

项目将顺序学习、行情复盘、Bit浪浪交割单分析和仓位复盘整合为一个 React 应用。行情复盘 / Bit浪浪 / 顺序学习进复盘的 K 线通过 CCXT 获取 Bybit USDT 永续合约数据。仓位复盘中 `BTCUSDT` / `ETHUSDT` 走同一套 Bybit 缓存；其余合约走该仓位所属交易所（Bitget 或 Gate），写入独立表 `venue_market_*`，本所失败且 Bybit 目录有该合约时再回退 Bybit。本地使用 SQLite 做行情与仓位缓存。

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
- 支持多种画图工具、撤销、重做、锁定和磁吸。
- 支持持久化画图和模拟交易。
- 图表向左右边界移动时自动延展历史行情。

### bit浪浪实盘分析

- 左侧展示导入的历史交割单，右侧展示对应 K 线。
- 显示开仓、平仓标记和交易指标。
- 支持交易对、方向、盈亏、持仓时间筛选和排序。
- 点击交易或切换周期后，交易区间自动回到图表中央。
- 画图按交割单持久化；刷新后仍在，切换周期保留，切换交易后加载该笔画图。

### 仓位复盘

- 使用本机保存的 Bitget UTA / Gate **只读**密钥，手动同步约 90 天已平仓与当前持仓；两所仓位汇聚在同一列表。
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

行情复盘、Bit浪浪与顺序学习进复盘共用同一套 Bybit K 线缓存（`market_candles`）。仓位复盘仅对 BTC/ETH 使用这套缓存；其它合约写入 `venue_market_candles` / `venue_market_cache_ranges`。各入口的展示窗口和业务标记不同，但相同 Symbol、周期和时间对应的 Bybit 行情来自同一张表。

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
