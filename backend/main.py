import json
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.staticfiles import StaticFiles
from dotenv import load_dotenv

from app.db.init_db import init_db
from app.db.provider_dao import seed_default_providers
from app.exceptions.exception_handlers import register_exception_handlers
# from app.db.model_dao import init_model_table
# from app.db.provider_dao import init_provider_table
from app.utils.logger import get_logger
from app.utils.path_helper import resolve_app_path
from app import create_app
from app.services.transcriber_config_manager import TranscriberConfigManager
from events import register_handler
from ffmpeg_helper import ensure_ffmpeg_or_raise

logger = get_logger(__name__)
load_dotenv()

# 读取 .env 中的路径
static_path = os.getenv('STATIC', '/static')
out_dir = resolve_app_path(os.getenv('OUT_DIR', './static/screenshots'))

# 自动创建本地目录（static 和 static/screenshots）
# 全部锚定到后端目录（main.py 所在目录），与启动 CWD 无关
static_dir = resolve_app_path("static")
uploads_dir = resolve_app_path("uploads")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
if not os.path.exists(uploads_dir):
    os.makedirs(uploads_dir)

if not os.path.exists(out_dir):
    os.makedirs(out_dir)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动序列拆成 5 步、每步独立日志 + 异常时打明确的 [startup N/5 FAILED] 标记。
    # 目的：用户 docker logs 一眼能看出后端死在哪一步，避免「容器一直重启但看不出原因」。
    try:
        logger.info("[startup 1/5] register_handler() — 注册事件处理器")
        register_handler()

        logger.info("[startup 2/5] init_db() — 初始化 SQLite 数据库")
        init_db()

        logger.info("[startup 3/5] TranscriberConfigManager — 读取转写器配置")
        # 转写器不再在启动时强制初始化，而是在首次生成笔记时按需创建。
        # 如果配置了不可用的类型（如 mlx-whisper 未安装），会在使用时报错而非静默回退。
        _cfg = TranscriberConfigManager().get_config()
        logger.info(
            f"           当前转写器: type={_cfg['transcriber_type']}, "
            f"model_size={_cfg['whisper_model_size']}"
        )

        logger.info("[startup 4/5] seed_default_providers() — 初始化默认 LLM 供应商")
        seed_default_providers()

        # 把已配置的代理 export 到环境变量，让 huggingface_hub（whisper 模型下载）
        # 也能走代理——含转写时的按需下载（issue #417）。
        from app.services.proxy_config_manager import ProxyConfigManager
        _proxy = ProxyConfigManager().apply_to_env()
        if _proxy:
            logger.info(f"           已应用全局代理到环境变量: {_proxy}")

        logger.info("[startup 5/5] 启动完成，等待请求")

        # 异步任务管道：一次性注册三阶段回调（任务无关），由 run_note_task 入队
        try:
            from app.routers.note import (
                _pipeline_download,
                _pipeline_transcribe,
                _pipeline_summarize,
            )
            from app.services.task_pipeline import task_pipeline

            task_pipeline.register_phase('download', _pipeline_download)
            task_pipeline.register_phase('transcribe', _pipeline_transcribe)
            task_pipeline.register_phase('summarize', _pipeline_summarize)
            logger.info("[startup 5c/5] 任务管道阶段回调已注册")
        except Exception as _pe:
            logger.warning(f"任务管道阶段回调注册失败: {_pe}")

        # 自动清理调度线程：配置开启时按周期清理选中的生成物
        try:
            from app.services.auto_cleanup_scheduler import auto_cleanup_scheduler

            auto_cleanup_scheduler.start()
            logger.info("[startup 5b/5] 自动清理调度线程已就绪")
        except Exception as _se:
            logger.warning(f"自动清理调度线程启动失败: {_se}")

        logger.info("[startup 6/6] 恢复卡住的中间状态任务")
        try:
            from app.utils.output_paths import JSON_OUTPUT_DIR, note_json_path
            from app.enmus.task_status_enums import TaskStatus
            from app.db.video_task_dao import list_all_task_ids
            json_dir = JSON_OUTPUT_DIR
            stuck_statuses = {
                TaskStatus.TRANSCRIBING.value,
                TaskStatus.SUMMARIZING.value,
                TaskStatus.FORMATTING.value,
                TaskStatus.SAVING.value,
                # 下载/解析/排队中被打断同样会冻结（kill -9 重启时）
                TaskStatus.DOWNLOADING.value,
                TaskStatus.PARSING.value,
                TaskStatus.PENDING.value,
            }
            recovered = 0
            # 优化：从 DB 取 task_id 集合（轻量查询，不反序列化 request_payload），
            # 跳过已有 result JSON 的终态任务，把启动期扫描从"全目录 glob"降到
            # "DB 行数 × 次 stat"（538 vs 790+）。
            task_ids = list_all_task_ids()
            for task_id in task_ids:
                if note_json_path(task_id).exists():
                    continue  # result 文件存在 → 任务已终态，无需检查 status 文件
                status_path = json_dir / f"{task_id}.status.json"
                if not status_path.exists():
                    continue
                try:
                    st = json.loads(status_path.read_text(encoding="utf-8")).get("status", "")
                except Exception:
                    continue
                if st in stuck_statuses:
                    new_data = {"status": TaskStatus.RETRYABLE.value, "message": f"后端重启时任务被中断，请点击重试 (原状态: {st})"}
                    tmp = status_path.with_suffix(".tmp")
                    tmp.write_text(json.dumps(new_data, ensure_ascii=False, indent=2), encoding="utf-8")
                    tmp.replace(status_path)
                    recovered += 1
            if recovered:
                logger.info(f"  共 {recovered} 个卡住任务已标记为可重试（RETRYABLE）")
        except Exception as _e:
            logger.warning(f"  恢复卡住任务失败: {_e}")
    except Exception:
        logger.exception("[startup FAILED] 后端启动期异常，详见堆栈；容器会退出并由 restart 策略决定是否重试")
        raise

    yield

app = create_app(lifespan=lifespan)

# 允许的源：本地 web 端 + Tauri 桌面端 + 浏览器扩展（chrome/edge/firefox）
# 用 regex 是因为 chrome-extension://<id> 的 id 在每次开发版加载时不固定
# Tauri 2 不同平台 webview origin 不一样，必须全列：
#   - macOS:   tauri://localhost  （自定义协议）
#   - Windows: https://tauri.localhost  （Edge WebView2）
#   - Linux:   http://tauri.localhost   （WebKitGTK）
# 漏掉哪个都会导致桌面端 fetch 返回 200 但 browser 因为 CORS 拒绝读响应，
# 表现为前端「连不上后端」但后端日志一片 200 OK。
CORS_ORIGIN_REGEX = (
    r"^chrome-extension://[a-z]+$"
    r"|^moz-extension://.+$"
    r"|^http://(localhost|127\.0\.0\.1)(:\d+)?$"
    r"|^tauri://localhost$"
    r"|^https?://tauri\.localhost$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
register_exception_handlers(app)
app.mount(static_path, StaticFiles(directory=static_dir), name="static")
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")









if __name__ == "__main__":
    port = int(os.getenv("BACKEND_PORT", 8483))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=False)