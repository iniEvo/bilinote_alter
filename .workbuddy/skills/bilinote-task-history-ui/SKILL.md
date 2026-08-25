---
name: bilinote-task-history-ui
description: 维护 BiliNote 生成历史页面的“批次任务 / 单个任务”展示逻辑、批次展开明细，以及批次移出视图但保留笔记的交互语义。
agent_created: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
  - TaskCreate
  - TaskGet
  - TaskUpdate
  - TaskList
disable: false
---

# BiliNote Task History UI

## When to Use

- 用户要求调整“生成历史”页的结构、筛选、折叠、分页或展示顺序
- 用户要求区分“批次任务”和“单个任务”
- 用户要求删除批次时保留已生成的笔记内容，只移除任务分组关系
- 需要排查批次页看不到全部子任务、只显示局部任务、或前端与后端删除语义不一致的问题

## Key Files

- 前端历史容器：`BillNote_frontend/src/pages/HomePage/components/History.tsx`
- 批次面板：`BillNote_frontend/src/pages/HomePage/components/BatchTaskPanel.tsx`
- 单任务历史：`BillNote_frontend/src/pages/HomePage/components/NoteHistory.tsx`
- 任务 store：`BillNote_frontend/src/store/taskStore/index.ts`
- 任务接口：`BillNote_frontend/src/services/note.ts`
- 后端任务路由：`backend/app/routers/note.py`
- 后端任务 DAO：`backend/app/db/video_task_dao.py`

## Current Conventions

- 生成历史页拆分为两个页签：`批次任务` 和 `单个任务`
- `单个任务` 只显示 `task.batchId` 为空的任务
- 批次展开后应展示当前筛选下的全部子任务，不再按页截断
- 批次卡片的删除语义不是删除笔记，而是“移出批次视图”
- “移出批次视图”通过清空数据库里的 `batch_id` / `batch_name` 实现，不能删除 note json / markdown / transcript 等产物

## Workflow

### 1. 先确认需求影响层

- 仅前端展示调整：优先改 `History.tsx` / `BatchTaskPanel.tsx`
- 牵涉任务归属语义：同步检查 `taskStore/index.ts` 和后端 `note.py` / `video_task_dao.py`

### 2. 做页签结构调整

- 使用 `components/ui/tabs.tsx`
- `History.tsx` 内保留统一搜索框
- `batch` 页签展示 `BatchTaskPanel`
- `single` 页签展示 `NoteHistory`
- 页签标题带数量：批次数、单任务数

### 3. 做批次子任务展示调整

- 批次展开后直接列出全部子任务
- 如果本地 `taskMap` 缺失某个批次子任务，允许用 `createHistoryTask(item)` 从远端 history item 构建兜底卡片
- 不要因为本地缓存未命中而把子任务静默丢掉

### 4. 做批次移出语义调整

- 前端不要再对批次下每个任务调用 `/delete_task`
- 新增单独接口，例如 `/detach_batch_tasks`
- 后端通过 DAO 把该批次所有任务的 `batch_id` 和 `batch_name` 清空
- 成功后前端本地状态也要把对应任务转成非批次任务，保证它们出现在“单个任务”页签

### 5. 验证

至少执行：

```bash
cd "/Users/jiuyue/Documents/project/BiliNote/BillNote_frontend" && pnpm build
"/Users/jiuyue/Documents/project/BiliNote/backend/.venv313/bin/python" -m py_compile \
  "/Users/jiuyue/Documents/project/BiliNote/backend/app/db/video_task_dao.py" \
  "/Users/jiuyue/Documents/project/BiliNote/backend/app/routers/note.py"
```

## Known Good State

截至 `2026-08-25`：
- `History.tsx` 已拆成批次/单任务两个页签
- `BatchTaskPanel.tsx` 已改为展开后展示全部子任务，并可用 `createHistoryTask` 补全缺失项
- 批次删除已改为“移出批次视图，保留笔记”
- 后端新增 `/detach_batch_tasks`，DAO 新增 `clear_batch_by_id(batch_id)`
