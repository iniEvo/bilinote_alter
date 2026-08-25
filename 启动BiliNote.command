#!/bin/bash
set -euo pipefail

ROOT="/Users/jiuyue/Documents/project/BiliNote"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/BillNote_frontend"
FFMPEG_BIN_DIR="/Users/jiuyue/.local/bin"
HF_ENDPOINT_DEFAULT="https://hf-mirror.com"
BACKEND_PORT="8483"
FRONTEND_PORT="3015"
BACKEND_READY_URL="http://127.0.0.1:${BACKEND_PORT}/api/sys_check"
BACKEND_INFO_URL="http://127.0.0.1:${BACKEND_PORT}/api/sys_health"
FRONTEND_READY_URL="http://127.0.0.1:${FRONTEND_PORT}/"
BACKEND_LOG="$ROOT/backend-launch.log"
FRONTEND_LOG="$ROOT/frontend-launch.log"

if [ -x "$ROOT/.venv/bin/python" ]; then
  PYTHON_BIN="$ROOT/.venv/bin/python"
elif [ -x "$BACKEND_DIR/.venv313/bin/python" ]; then
  PYTHON_BIN="$BACKEND_DIR/.venv313/bin/python"
else
  PYTHON_BIN="$(command -v python3 2>/dev/null || true)"
fi

require_command() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少依赖: $cmd"
    echo "$hint"
    exit 1
  fi
}

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempts="$3"
  local delay="$4"

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name 已就绪"
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

show_failure_hint() {
  local name="$1"
  local log_file="$2"

  echo
  echo "$name 启动失败，请查看日志: $log_file"
  if [ -f "$log_file" ]; then
    echo "----- 最近日志 -----"
    tail -n 20 "$log_file"
    echo "-------------------"
  fi
}

start_backend() {
  if is_port_listening "$BACKEND_PORT"; then
    echo "后端已在 ${BACKEND_PORT} 端口运行"
    return 0
  fi

  if [ -z "$PYTHON_BIN" ] || [ ! -x "$PYTHON_BIN" ]; then
    echo "未找到可用的 Python 解释器。"
    echo "请先检查虚拟环境，当前期望路径: $ROOT/.venv/bin/python 或 $BACKEND_DIR/.venv313/bin/python"
    exit 1
  fi

  echo "启动后端..."
  (
    cd "$BACKEND_DIR"
    env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
      FFMPEG_BIN_PATH="$FFMPEG_BIN_DIR" \
      HF_ENDPOINT="${HF_ENDPOINT:-$HF_ENDPOINT_DEFAULT}" \
      PATH="$FFMPEG_BIN_DIR:$PATH" \
      WHISPER_MODEL_SIZE=tiny \
      "$PYTHON_BIN" main.py
  ) > "$BACKEND_LOG" 2>&1 &

  if ! wait_for_url "后端" "$BACKEND_READY_URL" 20 1; then
    show_failure_hint "后端" "$BACKEND_LOG"
    exit 1
  fi
}

start_frontend() {
  if is_port_listening "$FRONTEND_PORT"; then
    echo "前端已在 ${FRONTEND_PORT} 端口运行"
    return 0
  fi

  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "前端依赖似乎未安装: $FRONTEND_DIR/node_modules 不存在"
    echo "请先执行: cd \"$FRONTEND_DIR\" && pnpm install"
    exit 1
  fi

  echo "启动前端..."
  (
    cd "$FRONTEND_DIR"
    pnpm dev --host 0.0.0.0
  ) > "$FRONTEND_LOG" 2>&1 &

  if ! wait_for_url "前端" "$FRONTEND_READY_URL" 20 1; then
    show_failure_hint "前端" "$FRONTEND_LOG"
    exit 1
  fi
}

main() {
  require_command "lsof" "macOS 一般自带 lsof，如缺失请先安装命令行工具。"
  require_command "curl" "macOS 一般自带 curl，如缺失请先安装命令行工具。"
  require_command "pnpm" "请先安装 pnpm，或用 corepack enable pnpm 初始化。"
  require_command "open" "当前系统不支持 open 命令，请手动打开浏览器访问。"

  start_backend
  start_frontend

  echo
  echo "BiliNote 启动完成："
  echo "前端: http://localhost:${FRONTEND_PORT}/"
  echo "后端: http://localhost:${BACKEND_PORT}/"
  echo "后端健康检查: $BACKEND_INFO_URL"
  echo
  echo "日志文件："
  echo "- $BACKEND_LOG"
  echo "- $FRONTEND_LOG"

  open "http://localhost:${FRONTEND_PORT}/"
}

main
