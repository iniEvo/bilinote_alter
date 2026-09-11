#!/usr/bin/env bash
# 通过 mise tasks 启停 BiliNote（后端 8483 + 前端 3015）。
# 保证同时只有一套服务：以「监听端口」为权威判据，pid 文件仅作辅助清理线索。
# 无论实例是怎么起来的（本脚本 / 旧版 nohup / launchd / 手动），只要端口被占就不重复拉起。

set -euo pipefail

ROOT="${MISE_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/BillNote_frontend"
RUN_DIR="$ROOT/.run"
BACKEND_PID="$RUN_DIR/backend.pid"
FRONTEND_PID="$RUN_DIR/frontend.pid"

# 系统工具走绝对路径，避免 mise 任务的隔离 PATH 找不到
LSOF="$(command -v lsof || echo /usr/sbin/lsof)"
CURL="$(command -v curl || echo /usr/bin/curl)"

# 从 .env 读端口并去掉行内注释（.env 中可能是 "8483 # 后端端口"）
env_val() {
  grep -E "^$1=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]*#.*$//' | tr -d ' \r' || true
}

BACKEND_PORT="$(env_val BACKEND_PORT)"
BACKEND_PORT="${BACKEND_PORT:-8483}"
FRONTEND_PORT="$(env_val FRONTEND_PORT)"
FRONTEND_PORT="${FRONTEND_PORT:-3015}"
BACKEND_LOG="$ROOT/backend-launch.log"
FRONTEND_LOG="$ROOT/frontend-launch.log"
VITE_PORT="$(env_val VITE_FRONTEND_PORT)"
VITE_PORT="${VITE_PORT:-$FRONTEND_PORT}"

log() { printf '\033[36m[mise]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[mise] 错误:\033[0m %s\n' "$*" >&2; }

# 监听指定端口的 pid；无则输出空
port_pid() {
  $LSOF -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

pid_alive() { # $1: pid
  [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

# 是否已在运行：端口被占即视为运行中（权威）；无 pid 文件或 pid 已死都无妨
is_running() { # $1: 端口
  local p
  p="$(port_pid "$1")"
  [ -n "$p" ]
}

stop_by_port() { # $1: 端口 $2: 名称
  local pids
  pids="$(port_pid "$1")" || true
  if [ -n "$pids" ]; then
    log "停止 $2 (端口 $1, pid $pids)..."
    kill $pids 2>/dev/null || true
    for _ in $(seq 1 15); do
      [ -n "$(port_pid "$1")" ] || break
      sleep 1
    done
    if [ -n "$(port_pid "$1")" ]; then
      log "$2 未退出，强制结束"
      kill -9 $pids 2>/dev/null || true
    fi
  fi
  rm -f "$3" 2>/dev/null || true
}

start_backend() {
  if is_running "$BACKEND_PORT"; then
    log "后端已在运行，复用（端口 ${BACKEND_PORT}）"
    return 0
  fi
  mkdir -p "$RUN_DIR"
  log "启动后端..."
  local child_pid
  nohup "$BACKEND_DIR/.venv313/bin/python" "$BACKEND_DIR/main.py" \
    >"$BACKEND_LOG" 2>&1 < /dev/null &
  child_pid=$!
  for i in $(seq 1 30); do
    if $CURL -fsS "http://127.0.0.1:${BACKEND_PORT}/api/sys_check" >/dev/null 2>&1; then
      echo "$child_pid" > "$BACKEND_PID"
      log "后端已就绪 http://127.0.0.1:${BACKEND_PORT}"
      return 0
    fi
    sleep 1
  done
  err "后端启动超时，最近日志："
  tail -n 20 "$BACKEND_LOG" >&2 || true
  return 1
}

start_frontend() {
  if is_running "$FRONTEND_PORT"; then
    log "前端已在运行，复用（端口 ${FRONTEND_PORT}）"
    return 0
  fi
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    err "前端依赖未安装：$FRONTEND_DIR/node_modules 不存在，请先执行 cd BillNote_frontend && pnpm install"
    return 1
  fi
  mkdir -p "$RUN_DIR"
  log "启动前端 (vite dev)..."
  local child_pid
  nohup pnpm --dir "$FRONTEND_DIR" dev --host 0.0.0.0 \
    >"$FRONTEND_LOG" 2>&1 < /dev/null &
  child_pid=$!
  for i in $(seq 1 60); do
    if $CURL -fsS "http://127.0.0.1:${FRONTEND_PORT}/" >/dev/null 2>&1; then
      echo "$child_pid" > "$FRONTEND_PID"
      log "前端已就绪 http://127.0.0.1:${FRONTEND_PORT}"
      return 0
    fi
    sleep 1
  done
  err "前端启动超时，最近日志："
  tail -n 20 "$FRONTEND_LOG" >&2 || true
  return 1
}

cmd_up() {
  start_backend
  start_frontend
  log "BiliNote 已启动："
  log "  前端 http://localhost:${FRONTEND_PORT}/"
  log "  后端 http://127.0.0.1:${BACKEND_PORT}"
  log "  停止：mise run stop"
}

cmd_stop() {
  stop_by_port "$BACKEND_PORT" "后端" "$BACKEND_PID"
  stop_by_port "$FRONTEND_PORT" "前端" "$FRONTEND_PID"
  log "服务已停止"
}

cmd_backend() {
  start_backend
  log "后端日志: $BACKEND_LOG"
}

cmd_frontend() {
  start_frontend
  log "前端日志: $FRONTEND_LOG"
}

case "${1:-up}" in
  up)       cmd_up ;;
  stop)     cmd_stop ;;
  backend)  cmd_backend ;;
  frontend) cmd_frontend ;;
  *) err "未知命令: $1（支持 up/stop/backend/frontend）"; exit 1 ;;
esac
