"""抖音主页笔记补全：比对主页作品与已有笔记，为缺失的视频补生成笔记。

解决「追更」场景：关注一个抖音博主后，每次他发布新视频，手动一个个贴链接
太低效。本工具一次抓取主页全部作品，与库里已有笔记比对，把还没生成笔记的
新视频批量提交到 BiliNote，并直接归入指定项目。

用法：
  # 预览（默认 dry-run，只抓取和比对，不创建任何任务）
  python backend/scripts/sync_douyin_profile_notes.py \\
      --url https://www.douyin.com/user/MS4wLjABAAAA... \\
      --project "后期钉 杰瑞"

  # 确认无误后真正提交
  python backend/scripts/sync_douyin_profile_notes.py \\
      --url https://www.douyin.com/user/MS4wLjABAAAA... \\
      --project "后期钉 杰瑞" --apply

  # 指定风格/模型（默认取当前唯一启用的模型 + detailed 详细风格）
  python backend/scripts/sync_douyin_profile_notes.py --url ... --project ... \\
      --style tutorial --apply

  # 只比对指定项目内的已有笔记（默认比对全库，避免跨项目重复生成）
  python backend/scripts/sync_douyin_profile_notes.py --url ... --project ... \\
      --scope-project --apply

前置条件：
  1. 后端已启动（默认 http://127.0.0.1:8483，可用 --base-url 覆盖）；
  2. 已配置有效的抖音 Cookie（设置 → 下载器配置）；
  3. 目标项目已存在（本工具不新建项目，避免拼错名字创建出脏数据）。
"""
import argparse
import logging
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# 与 services/douyin_profile_sync.DEFAULT_BASE_URL 保持一致。
# 这里重复一份常量而非 import，是为了让本模块在导入时零副作用：
# 服务层会拉入下载器 / DB DAO，进而触发转录器与任务管道的初始化日志，
# 对 `--help` 这类纯参数场景是纯噪音。真正的 app 依赖延迟到 main() 内导入。
DEFAULT_BASE_URL = 'http://127.0.0.1:8483'


def _quiet_app_logs() -> None:
    """压掉应用日志噪音（转录器就绪检查、任务管道初始化等）。

    导入下载器会间接触发 task_pipeline / transcriber 的初始化日志，
    对一次性 CLI 工具属于纯噪音。注意 app.utils.logger.get_logger 会给每个
    子 logger 无条件 setLevel(INFO)，改父级 'app' 的级别无效，
    因此这里用 logging.disable 全局压到 WARNING 以上（不区分命名空间，
    但本脚本的输出全部走 print，不受影响）。--verbose 可恢复全量日志。
    """
    logging.disable(logging.WARNING)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='比对抖音主页作品与已有笔记，为缺失视频补生成笔记',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        '--url',
        required=True,
        help='抖音用户主页链接（也可直接粘贴 sec_uid）',
    )
    parser.add_argument(
        '--project',
        default='',
        help='笔记要归入的项目名（或 batch_id）。省略则归入「未分组」',
    )
    parser.add_argument(
        '--style',
        default='detailed',
        help='笔记风格，默认 detailed（详细）。可选：minimal/detailed/tutorial/academic/...',
    )
    parser.add_argument(
        '--provider-id',
        default='',
        help='模型供应商 ID；与 --model-name 成对使用，省略则取当前启用模型的第一个',
    )
    parser.add_argument(
        '--model-name',
        default='',
        help='模型名；与 --provider-id 成对使用',
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=60,
        help='最多翻页次数（每页最多 20 条），默认 60 即最多 1200 条，防异常无限翻页',
    )
    parser.add_argument(
        '--base-url',
        default=DEFAULT_BASE_URL,
        help=f'后端地址，默认 {DEFAULT_BASE_URL}',
    )
    parser.add_argument(
        '--scope-project',
        action='store_true',
        help='只把「指定项目内」的笔记视为已生成；默认按全库比对（跨项目也算已有）',
    )
    parser.add_argument(
        '--max-submit',
        type=int,
        default=0,
        help='单次最多提交多少个任务（0=不限）。大批量补更时用于控制队列压力',
    )
    parser.add_argument(
        '--newest-first',
        action='store_true',
        help='配合 --max-submit 使用：优先补最新作品（默认按主页返回顺序）',
    )
    parser.add_argument(
        '--refresh',
        action='store_true',
        help='忽略本地缓存强制重新抓取主页（缓存默认 30 分钟，用于降低风控风险）',
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='真正提交生成任务；不加此参数为 dry-run，只预览待生成清单',
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='输出应用日志（默认只保留 WARNING 以上，避免初始化噪音）',
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not args.verbose:
        _quiet_app_logs()

    from app.downloaders.douyin_downloader import DouyinDownloader
    from app.services.douyin_profile_sync import (
        DouyinProfileSyncError,
        build_plan,
        format_plan,
        resolve_batch,
        resolve_model,
        select_pending,
        submit_missing,
    )

    sec_uid = DouyinDownloader.extract_sec_uid(args.url)
    if not sec_uid:
        print(f'错误：无法从 --url 解析出 sec_uid：{args.url}', file=sys.stderr)
        return 2

    # ── 解析项目与模型（先做，避免抓了一堆数据才发现参数不对）──
    try:
        batch_id, batch_name = resolve_batch(args.project, base_url=args.base_url)
    except DouyinProfileSyncError as exc:
        print(f'错误：{exc}', file=sys.stderr)
        return 2

    # resolve_model 在未显式指定时回退到当前唯一启用的模型，
    # 显式指定时校验该组合已登记（避免任务入队后才失败）。
    try:
        provider_id, model_name = resolve_model(
            base_url=args.base_url,
            provider_id=args.provider_id or None,
            model_name=args.model_name or None,
        )
    except DouyinProfileSyncError as exc:
        print(f'错误：{exc}', file=sys.stderr)
        return 2
    # ── 抓取 + 比对 ──
    print(f'正在抓取抖音主页作品：{sec_uid[:24]}...')
    try:
        plan = build_plan(sec_uid, limit=args.limit, refresh=args.refresh)
    except DouyinProfileSyncError as exc:
        print(f'错误：{exc}', file=sys.stderr)
        return 1

    if args.scope_project and batch_id:
        scoped = {
            vid: note
            for vid, note in plan.existing.items()
            if note.batch_id == batch_id and note.has_result
        }
        plan.missing = [p for p in plan.posts if p.aweme_id not in scoped]

    # 先算出本次真正会提交的子集，预览即所得（--max-submit / --newest-first 生效）
    targets = select_pending(plan, limit=args.max_submit or None, newest_first=args.newest_first)

    print()
    print(format_plan(plan, batch_id=batch_id, preview=targets))
    print()

    if not plan.missing:
        print('该主页所有作品都已有笔记，无需生成。')
        return 0

    project_text = batch_name or '未分组'
    model_text = f'{provider_id}/{model_name}'
    print(f'目标项目：{project_text}')
    print(f'使用模型：{model_text}')
    print(f'笔记风格：{args.style}')

    if not args.apply:
        print()
        if len(targets) < len(plan.missing):
            print(f'注意：本次将只提交 {len(targets)} 条（--max-submit），'
                  f'剩余 {len(plan.missing) - len(targets)} 条需再跑一次补齐。')
        print('DRY-RUN 结束，未创建任何任务。确认无误后加 --apply 执行。')
        return 0

    print()
    print(f'正在提交 {len(targets)} 个任务'
          f'{f"（共待生成 {len(plan.missing)} 条，本次截取）" if len(targets) < len(plan.missing) else ""}...')
    try:
        result = submit_missing(
            plan,
            provider_id=provider_id,
            model_name=model_name,
            style=args.style,
            batch_id=batch_id,
            batch_name=batch_name,
            base_url=args.base_url,
            posts=targets,
        )
    except DouyinProfileSyncError as exc:
        print(f'错误：{exc}', file=sys.stderr)
        return 1

    submitted = result.get('submitted') or []
    rejected = result.get('rejected') or []
    print(f'提交成功：{len(submitted)} 个')
    for task in submitted:
        print(f"  {task.get('task_id', '')[:8]}  {task.get('video_url')}")
    if rejected:
        print(f'被拒绝：{len(rejected)} 个')
        for task in rejected:
            print(f"  {task.get('video_url')}  ->  {task.get('msg')}")

    print()
    if submitted:
        print(f'任务已进入生成管道，可在前端「{project_text}」项目中查看进度。')
    remaining = len(plan.missing) - len(submitted)
    if remaining > 0:
        print(f'本次未提交 {remaining} 条，可再运行一次继续补齐。')
    return 0 if submitted or not rejected else 1


if __name__ == '__main__':
    raise SystemExit(main())
