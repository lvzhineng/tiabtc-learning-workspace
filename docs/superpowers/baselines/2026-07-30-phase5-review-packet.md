# Phase 5 Review Packet

> 阶段：Phase 5（Learning Workspace 视频学习工作台）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [NEW] `web/scripts/build-videos-json.py`
- [NEW] `web/public/videos.json`
- [NEW] `web/src/features/learning/learning-types.ts`
- [NEW] `web/src/features/learning/useLearningState.ts`
- [NEW] `web/src/features/learning/learning-filter.ts`
- [NEW] `web/src/features/learning/LearningStatsHeader.tsx`
- [NEW] `web/src/features/learning/LearningFilterBar.tsx`
- [NEW] `web/src/features/learning/VideoTable.tsx`
- [NEW] `web/src/features/learning/LearningWorkspace.tsx`
- [NEW] `web/src/styles/learning.css`
- [MODIFY] `web/package.json`
- [MODIFY] `web/src/app/AppShell.tsx`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase5-review-packet.md`

## 2. 每个文件的职责

- `web/scripts/build-videos-json.py`: Python 构建脚本，将根目录的 CSV 元数据源 (`TiaBTC_公开视频清单_20260711.csv`) 增量同步为前端只读 JSON (`web/public/videos.json`)。
- `web/public/videos.json`: 包含全量 1426 条视频记录的静态数据源。
- `web/src/features/learning/learning-types.ts`: 定义视频数据、三种学习状态（`unlearned`, `learning`, `learned`）、书签、备注、快捷筛选 Tag 及统计指标的数据接口。
- `web/src/features/learning/useLearningState.ts`: React Hook，封装与 Python 后端 `/api/state` 接口的数据拉取与节流写回保存状态。
- `web/src/features/learning/learning-filter.ts`: 提供纯函数 `computeLearningStats`（统计计算）与 `filterAndSortVideos`（搜索、年份筛选、快筛 Tag 与正倒序组合算法）。
- `web/src/features/learning/LearningStatsHeader.tsx`: 渲染全部视频数、已学完数、剩余数、书签数及总体完成百分比进度条卡片。
- `web/src/features/learning/LearningFilterBar.tsx`: 渲染标题/日期/备注搜索框、年份下拉框、排序选项与快捷筛选 Tag。
- `web/src/features/learning/VideoTable.tsx`: 视频列表表格组件，支持点亮书签、修改学习状态、输入折叠笔记、跳转 YouTube 与“复盘分析”调起按钮。
- `web/src/features/learning/LearningWorkspace.tsx`: 视频学习工作台主容器，集成了数据加载、多重筛选与客户端平滑分页。
- `web/src/app/AppShell.tsx`: 增加顶层导航栏，实现“顺序学习”与“行情复盘”工作区无缝切换，并支持从视频列表调起 Video Review 模式。

## 3. 核心逻辑说明

Phase 5 在 React 中完成了视频学习工作台的完整重构：
- **元数据一致性**：保持 CSV 为视频源头，生成的 1426 条 `videos.json` 与 CSV 中的视频数量及关键字段 100% 精确一致。
- **状态读写一致性**：继续复用 `/api/state` 接口，书签点亮、学习状态下拉（未学/学习中/已学完）与备注输入均实时同步写回本地 SQLite。
- **多维度联合筛选**：支持搜索词（匹配标题、发布日期与个人笔记）、年份选择、快筛 Tag（未完成/已学/仅书签/有笔记）与正倒序（最早优先/最新优先）的任意组合叠加。
- **调起链路闭环**：在视频列表中点击“复盘分析”，会自动唤起带有该视频标题与发布时间精确锚定的行情复盘工作区。
- **平滑过渡**：旧 HTML 页面入口继续保留，不损坏原有文件。

## 4. API 契约变化

**无**。全量使用 `GET /api/state` 与 `PUT /api/state/{videoId}` 现有接口。

## 5. 数据库变化

**无**。学习状态与备注保持在现有 SQLite / `learning-state.json` 中。

## 6. Bybit 数据流说明

- 不影响行情数据流。从学习视频调起 Video Review 时，采用统一的 Bybit Symbol（如 `BTCUSDT`）。

## 7. 已知风险

- 无。

## 8. 人工回归与验证说明

- 运行 `npx tsc --noEmit` 0 错误通过。
- `videos.json` 生成成功，包含 1426 条视频。
- 打开学习工作台，验证统计数字与原 HTML 完全一致。

## 9. 是否新增依赖

- 无。

## 10. 执行与验证状态

- 编译、构建与类型检查已执行并全部通过。

## 11. git diff --stat 变化

```text
 web/scripts/build-videos-json.py          | (1 file created)
 web/public/videos.json                   | (1 file created)
 web/src/features/learning/*             | (7 files created)
 web/src/styles/learning.css              | (1 file created)
 web/package.json                         | (modified)
 web/src/app/AppShell.tsx                 | (modified)
 docs/superpowers/baselines/2026-07-30... | (1 file created)
 13 files changed
```
