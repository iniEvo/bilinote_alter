---
name: start-bilinote-local
description: 在当前 BiliNote 项目中稳定启动本地前后端，并在启动失败时快速定位是 Python 环境、前端依赖还是服务未就绪问题。
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

# Start BiliNote Local

## When to Use

- 用户要求“启动 BiliNote”“打开 BiliNote”“跑本地前后端”
- 本地启动脚本运行失败，需要快速判断是环境路径、依赖还是服务健康检查问题
- 需要确认当前服务是否已经在 `3015` / `8483` 端口运行

## Project Assumptions

- 项目根目录：`/Users/jiuyue/Documents/project/BiliNote`
- 前端目录：`/Users/jiuyue/Documents/project/BiliNote/BillNote_frontend`
- 后端目录：`/Users/jiuyue/Documents/project/BiliNote/backend`
- 首选启动入口：`/Users/jiuyue/Documents/project/BiliNote/启动BiliNote.command`
- 后端健康检查：`http://127.0.0.1:8483/api/sys_check`
- 后端详细健康状态：`http://127.0.0.1:8483/api/sys_health`

## Workflow

### 1. 先读启动脚本

读取 `启动BiliNote.command`，确认：
- Python 路径是否优先检查根目录 `.venv`，其次回退 `backend/.venv313`
- 是否在启动后轮询 `3015` 和 `8483` 的就绪状态
- 是否在失败时打印 `backend-launch.log` 或 `frontend-launch.log`

### 2. 执行启动脚本

直接运行：

```bash
"/bin/bash" "/Users/jiuyue/Documents/project/BiliNote/启动BiliNote.command"
```

### 3. 如果启动失败，按顺序排查

#### 后端失败

- 读取 `backend-launch.log`
- 常见原因：
  - `/.venv/bin/python` 不存在
  - 实际可用环境是 `backend/.venv313/bin/python`
  - `ffmpeg` 不在 PATH 中
- 如果脚本路径错误，优先修启动脚本，不要每次手工输长命令兜底

#### 前端失败

- 读取 `frontend-launch.log`
- 检查 `BillNote_frontend/node_modules` 是否存在
- 若依赖缺失，提示先运行：

```bash
cd "/Users/jiuyue/Documents/project/BiliNote/BillNote_frontend" && pnpm install
```

### 4. 验证结果

至少检查：

```bash
curl -s http://127.0.0.1:8483/api/sys_health
curl -I -s http://127.0.0.1:3015/
```

通过标准：
- 前端首页返回 `200`
- `/api/sys_health` 返回 `backend=ok`、`ffmpeg=ok`、`db=ok`

## Known Good State

截至 `2026-08-24`：
- 前端开发服务端口：`3015`
- 后端服务端口：`8483`
- 当前可用后端 Python：`/Users/jiuyue/Documents/project/BiliNote/backend/.venv313/bin/python`
- 启动脚本已经支持：依赖检查、端口复用、前后端 ready probe、失败日志提示
