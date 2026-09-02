#!/bin/bash
set -euo pipefail

ROOT="/Users/jiuyue/Documents/project/BiliNote"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/BillNote_frontend"
MISE_BIN="/Users/jiuyue/.local/bin/mise"
# 从 mise 动态解析 ffmpeg 所在目录（mise 安装的 ffmpeg 路径含版本号，不写死）
FFMPEG_BIN_DIR="$("$MISE_BIN" which ffmpeg 2>/dev/null | xargs -r dirname)"
if [ -z "$FFMPEG_BIN_DIR" ] || [ ! -x "$FFMPEG_BIN_DIR/ffmpeg" ]; then
  # 兜底：扫描 mise installs 目录取最新版本
  FFMPEG_BIN_DIR="$(ls -d "$HOME"/.local/share/mise/installs/ffmpeg/*/.mise-bins 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$FFMPEG_BIN_DIR" ] || [ ! -x "$FFMPEG_BIN_DIR/ffmpeg" ]; then
  echo "错误: 未找到 mise 安装的 ffmpeg，请先执行 mise install ffmpeg"
  exit 1
fi
echo "使用 ffmpeg: $FFMPEG_BIN_DIR/ffmpeg ($("$FFMPEG_BIN_DIR/ffmpeg" -version 2>/dev/null | head -1))"
HF_ENDPOINT_DEFAULT="https://hf-mirror.com"
BACKEND_PORT="8483"
FRONTEND_PORT="3015"
BACKEND_READY_URL="http://127.0.0.1:${BACKEND_PORT}/api/sys_check"
BACKEND_INFO_URL="http://127.0.0.1:${BACKEND_PORT}/api/sys_health"
FRONTEND_READY_URL="http://127.0.0.1:${FRONTEND_PORT}/"
BACKEND_LOG="$ROOT/backend-launch.log"
FRONTEND_LOG="$ROOT/frontend-launch.log"
BACKEND_LABEL="com.jiuyue.bilinote.backend"
FRONTEND_LABEL="com.jiuyue.bilinote.frontend"
LAUNCH_AGENTS_DIR="/Users/jiuyue/Library/LaunchAgents"
BACKEND_PLIST="$LAUNCH_AGENTS_DIR/${BACKEND_LABEL}.plist"
FRONTEND_PLIST="$LAUNCH_AGENTS_DIR/${FRONTEND_LABEL}.plist"
BACKEND_LAUNCHER="$ROOT/bilinote-backend-launch.sh"
FRONTEND_LAUNCHER="$ROOT/bilinote-frontend-launch.sh"
# pnpm 由 mise 管理：优先用 mise 动态解析，兜底 PATH 中的 pnpm（原 workbuddy 路径已删除）
PNPM_BIN="$("$MISE_BIN" which pnpm 2>/dev/null || true)"
if [ -z "$PNPM_BIN" ] || [ ! -x "$PNPM_BIN" ]; then
  PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
fi
LAUNCHD_DOMAIN="gui/$(id -u)"

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

write_launch_agents() {
  mkdir -p "$LAUNCH_AGENTS_DIR"

  cat > "$BACKEND_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${BACKEND_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BACKEND_LAUNCHER}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${BACKEND_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>${BACKEND_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${BACKEND_LOG}</string>
</dict>
</plist>
EOF

  cat > "$FRONTEND_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${FRONTEND_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${FRONTEND_LAUNCHER}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${FRONTEND_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>${FRONTEND_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${FRONTEND_LOG}</string>
</dict>
</plist>
EOF

  chmod 700 "$BACKEND_LAUNCHER" "$FRONTEND_LAUNCHER"
  chmod 600 "$BACKEND_PLIST" "$FRONTEND_PLIST"
  plutil -lint "$BACKEND_PLIST" "$FRONTEND_PLIST" >/dev/null
}

launch_agent_loaded() {
  local label="$1"
  launchctl print "${LAUNCHD_DOMAIN}/${label}" >/dev/null 2>&1
}

bootstrap_agent() {
  local label="$1"
  local plist="$2"

  if launch_agent_loaded "$label"; then
    launchctl kickstart -k "${LAUNCHD_DOMAIN}/${label}" >/dev/null 2>&1 || true
    return 0
  fi

  if launchctl bootstrap "$LAUNCHD_DOMAIN" "$plist" >/dev/null 2>&1; then
    return 0
  fi

  echo "无法在当前会话自动注册 ${label}。"
  echo "请在普通 macOS Terminal 执行：launchctl bootstrap ${LAUNCHD_DOMAIN} ${plist}"
  return 1
}

start_backend_direct() {
  if [ -z "$PYTHON_BIN" ] || [ ! -x "$PYTHON_BIN" ]; then
    echo "未找到可用的 Python 解释器。"
    echo "请先检查虚拟环境，当前期望路径: $ROOT/.venv/bin/python 或 $BACKEND_DIR/.venv313/bin/python"
    exit 1
  fi

  echo "改为独立后台启动后端..."
  nohup env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
    FFMPEG_BIN_PATH="$FFMPEG_BIN_DIR" \
    HF_ENDPOINT="${HF_ENDPOINT:-$HF_ENDPOINT_DEFAULT}" \
    PATH="$FFMPEG_BIN_DIR:$PATH" \
    WHISPER_MODEL_SIZE=tiny \
    "$PYTHON_BIN" "$BACKEND_DIR/main.py" > "$BACKEND_LOG" 2>&1 < /dev/null &
}

start_backend() {
  if is_port_listening "$BACKEND_PORT"; then
    echo "后端已在 ${BACKEND_PORT} 端口运行"
    return 0
  fi

  echo "尝试通过 launchd 启动后端..."
  if ! bootstrap_agent "$BACKEND_LABEL" "$BACKEND_PLIST"; then
    start_backend_direct
  fi

  if ! wait_for_url "后端" "$BACKEND_READY_URL" 20 1; then
    show_failure_hint "后端" "$BACKEND_LOG"
    exit 1
  fi
}

start_frontend_direct() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "前端依赖似乎未安装: $FRONTEND_DIR/node_modules 不存在"
    echo "请先执行: cd \"$FRONTEND_DIR\" && \"$PNPM_BIN\" install"
    exit 1
  fi

  if [ ! -x "$PNPM_BIN" ]; then
    echo "未找到 pnpm 可执行文件: $PNPM_BIN"
    exit 1
  fi

  echo "改为独立后台启动前端..."
  nohup "$PNPM_BIN" --dir "$FRONTEND_DIR" dev --host 0.0.0.0 > "$FRONTEND_LOG" 2>&1 < /dev/null &
}

start_frontend() {
  if is_port_listening "$FRONTEND_PORT"; then
    echo "前端已在 ${FRONTEND_PORT} 端口运行"
    return 0
  fi

  echo "尝试通过 launchd 启动前端..."
  if ! bootstrap_agent "$FRONTEND_LABEL" "$FRONTEND_PLIST"; then
    start_frontend_direct
  fi

  if ! wait_for_url "前端" "$FRONTEND_READY_URL" 20 1; then
    show_failure_hint "前端" "$FRONTEND_LOG"
    exit 1
  fi
}

main() {
  require_command "lsof" "macOS 一般自带 lsof，如缺失请先安装命令行工具。"
  require_command "curl" "macOS 一般自带 curl，如缺失请先安装命令行工具。"
  require_command "open" "当前系统不支持 open 命令，请手动打开浏览器访问。"

  write_launch_agents
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
