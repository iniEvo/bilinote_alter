"""抖音主页笔记同步：比对主页作品与已有笔记，为缺失的视频补生成笔记。

把「抓主页 -> 与历史笔记比对 -> 批量提交生成」这条链路从一次性脚本沉淀为
可复用服务，CLI（backend/scripts/sync_douyin_profile_notes.py）与后续的
定时任务都调用这里，避免逻辑分叉。

设计要点：
- 抓取复用 DouyinDownloader（共享 Cookie 刷新、msToken、a_bogus 签名链路）；
- 比对口径与后端「重复笔记」判定保持一致：同一个 (platform, video_id) 只要存在
  一条**有笔记结果**的任务就视为已生成，失败/取消且无结果的不算数；
- 提交走与前端完全相同的 /api/generate_notes_batch 接口，不直接写库，
  确保任务进入正常的下载/转写/总结管道，而不是绕过队列。
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import requests

from app.db.video_task_dao import list_all_tasks
from app.downloaders.douyin_downloader import DouyinDownloader
from app.utils.logger import get_logger
from app.utils.output_paths import note_json_path, task_status_path
from app.utils.path_helper import get_app_dir

logger = get_logger(__name__)

DEFAULT_BASE_URL = 'http://127.0.0.1:8483'
DEFAULT_PLATFORM = 'douyin'

# 主页作品列表缓存时长。抓一个作品上千的账号需要约 50 次翻页请求，
# 反复全量重抓很容易触发抖音的 IP 级风控（403）。
# 追更场景下作品列表本就是准静态的，缓存半小时既够「同一天跑几次」，
# 又能把请求量降下来。需要强制重新抓取时用 --refresh。
DEFAULT_CACHE_TTL_SECONDS = 1800


@dataclass
class ProfilePost:
    aweme_id: str
    desc: str = ''
    create_time: int = 0
    duration: int = 0
    is_top: bool = False

    @property
    def canonical_url(self) -> str:
        return f'https://www.douyin.com/video/{self.aweme_id}'

    @property
    def title(self) -> str:
        return (self.desc or self.aweme_id).split('\n')[0].strip()

    def created_text(self) -> str:
        if not self.create_time:
            return ''
        return time.strftime('%Y-%m-%d', time.localtime(self.create_time))


@dataclass
class ExistingNote:
    task_id: str
    video_id: str
    status: Optional[str]
    batch_id: Optional[str]
    batch_name: Optional[str]
    title: Optional[str]
    has_result: bool


@dataclass
class SyncPlan:
    """一次同步的完整计划，dry-run 与真正执行共用，保证预览即所得。"""

    sec_uid: str
    nickname: str = ''
    aweme_count: Optional[int] = None
    posts: list[ProfilePost] = field(default_factory=list)
    existing: dict[str, ExistingNote] = field(default_factory=dict)
    missing: list[ProfilePost] = field(default_factory=list)

    @property
    def covered(self) -> int:
        return len(self.posts) - len(self.missing)

    def stale_in_project(self, batch_id: Optional[str]) -> list[ExistingNote]:
        """找出「归属指定项目、但已不在该主页」的笔记。

        只在给定项目时才有意义：同一个项目通常对应同一个博主，
        此时项目内有笔记的视频从主页消失，才真的说明被删除或设为私密。
        不限定项目时全库有大量其他博主的视频，混在一起毫无信息量。
        """
        if not batch_id:
            return []
        profile_ids = {p.aweme_id for p in self.posts}
        return [
            note
            for vid, note in self.existing.items()
            if vid not in profile_ids
            and note.has_result
            and note.batch_id == batch_id
        ]


class DouyinProfileSyncError(RuntimeError):
    """同步过程中的可预期错误（Cookie 失效、接口不可用等），CLI 直接展示文案。"""


def _has_note_result(task_id: str) -> bool:
    """笔记结果文件是否存在——这是「真的生成过笔记」的唯一权威判据。"""
    try:
        return note_json_path(task_id).exists()
    except Exception:
        return False


def _read_status(task_id: str) -> Optional[str]:
    try:
        with task_status_path(task_id).open('r', encoding='utf-8') as f:
            return json.load(f).get('status')
    except Exception:
        return None


def load_existing_notes(platform: str = DEFAULT_PLATFORM) -> dict[str, ExistingNote]:
    """读取库里符合平台的已有任务，按 video_id 归并。

    同一 video_id 可能有多行（历史重试产生的冗余行），只要有任意一行带笔记结果
    就算已生成；否则保留最新一行用于展示状态。
    """
    grouped: dict[str, ExistingNote] = {}
    for row in list_all_tasks():
        if (row.platform or '') != platform:
            continue
        video_id = str(row.video_id or '')
        if not video_id:
            continue

        has_result = _has_note_result(row.task_id)
        candidate = ExistingNote(
            task_id=row.task_id,
            video_id=video_id,
            status=_read_status(row.task_id),
            batch_id=row.batch_id,
            batch_name=getattr(row, 'batch_name', None),
            title=row.title,
            has_result=has_result,
        )

        current = grouped.get(video_id)
        if current is None or (has_result and not current.has_result):
            grouped[video_id] = candidate

    return grouped


def _describe_post_fetch_error(exc: Exception) -> str:
    """把作品列表接口的原始异常翻译成可操作的提示。

    抖音的 403 有两类成因，处置方式完全不同，而原始异常只是一条带完整
    签名的超长 URL，看不出该等还是该改 Cookie：
      - 高频抓取触发 IP 级限流：等待一段时间即可恢复（同一 Cookie 下，
        其它主页也会一起 403）；
      - Cookie 失效：需要在设置里更新抖音 Cookie。
    两者的响应体不同（限流常见 'Blocked by ArgusSecurityPlugin'），
    但客户端未必拿得到 body，因此提示里同时给出两种可能。
    """
    text = str(exc)
    if '403' in text or 'Forbidden' in text:
        return (
            '抖音返回 403，作品列表接口被风控拦截。常见原因有两种：\n'
            '  1) 短时间抓取次数过多触发 IP 限流 —— 等 10~30 分钟再试；\n'
            '     判断方法：用同一个 Cookie 抓其它主页若也 403，基本就是限流。\n'
            '  2) Cookie 失效 —— 在「设置 → 下载器配置」更新抖音 Cookie。\n'
            '（注：本工具已单次抓取整页并翻页，正常一天跑几次不会触发限流；'
            '短时间内反复调试同一个主页容易触发。）'
        )
    if 'timeout' in text.lower() or 'timed out' in text.lower():
        return f'请求抖音超时，请检查网络或代理后重试: {text[:200]}'
    return f'获取抖音作品列表失败: {text[:300]}'


def _cache_path(sec_uid: str) -> Path:
    cache_dir = Path(get_app_dir('douyin_profile_cache'))
    safe = ''.join(ch for ch in sec_uid if ch.isalnum() or ch in '-_')[:80]
    return cache_dir / f'{safe}.json'


def _load_cached(sec_uid: str, ttl_seconds: int) -> Optional[dict]:
    """读主页抓取缓存；不存在或已过期返回 None。

    缓存的意义不只是省时间：抓一个千条作品的账号要 ~50 次翻页请求，
    反复全量重抓会触发抖音的 IP 级风控（403），而作品列表在追更场景下
    本就准静态。TTL 内直接用缓存，能把请求量降到最低。
    """
    if ttl_seconds <= 0:
        return None
    path = _cache_path(sec_uid)
    try:
        with path.open('r', encoding='utf-8') as f:
            payload = json.load(f)
    except Exception:
        return None

    fetched_at = payload.get('fetched_at') or 0
    if time.time() - fetched_at > ttl_seconds:
        return None
    return payload


def _save_cache(sec_uid: str, profile: dict, posts: list['ProfilePost']) -> None:
    path = _cache_path(sec_uid)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('w', encoding='utf-8') as f:
            json.dump({
                'fetched_at': time.time(),
                'sec_uid': sec_uid,
                'profile': profile,
                'posts': [
                    {
                        'aweme_id': p.aweme_id,
                        'desc': p.desc,
                        'create_time': p.create_time,
                        'duration': p.duration,
                        'is_top': p.is_top,
                    }
                    for p in posts
                ],
            }, f, ensure_ascii=False)
    except Exception as exc:
        logger.warning('写入抖音主页缓存失败（不影响本次运行）: %s', exc)


def _clear_cache(sec_uid: str) -> None:
    try:
        _cache_path(sec_uid).unlink(missing_ok=True)
    except Exception:
        pass


def _decode_cache(payload: dict) -> tuple[dict, list[ProfilePost]]:
    profile = payload.get('profile') or {}
    posts = [
        ProfilePost(
            aweme_id=str(p.get('aweme_id') or ''),
            desc=p.get('desc', ''),
            create_time=p.get('create_time', 0),
            duration=p.get('duration', 0),
            is_top=bool(p.get('is_top')),
        )
        for p in (payload.get('posts') or [])
        if p.get('aweme_id')
    ]
    return profile, posts


def _load_stale_cache(sec_uid: str) -> Optional[dict]:
    """读任意年龄的缓存（不看 TTL），仅用于抓取失败后的降级。"""
    path = _cache_path(sec_uid)
    try:
        with path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def fetch_profile_posts(
    sec_uid: str,
    *,
    downloader: Optional[DouyinDownloader] = None,
    limit: int = 60,
    cache_ttl: Optional[int] = None,
    refresh: bool = False,
) -> tuple[dict, list[ProfilePost]]:
    """抓取用户资料与全部作品。返回 (profile, posts)。

    默认走缓存（TTL 见 DEFAULT_CACHE_TTL_SECONDS），refresh=True 强制重抓。
    抓取失败但存在过期缓存时会降级使用它，避免一次风控就让整个流程中断。
    """
    if not sec_uid:
        raise DouyinProfileSyncError('未能从链接中解析出 sec_uid，请确认主页链接完整')

    ttl = DEFAULT_CACHE_TTL_SECONDS if cache_ttl is None else cache_ttl

    if not refresh:
        cached = _load_cached(sec_uid, ttl)
        if cached:
            logger.info('命中抖音主页缓存（TTL 内），跳过抓取: %s', sec_uid[:24])
            return _decode_cache(cached)

    try:
        return _fetch_profile_posts_live(sec_uid, downloader=downloader, limit=limit)
    except DouyinProfileSyncError:
        # 抓取失败（典型是 403 风控）时，若有历史缓存就降级使用，
        # 让「比对已有笔记」这件事仍能进行，而不是直接中断。
        stale = _load_stale_cache(sec_uid)
        if stale and (stale.get('posts')):
            age_min = int((time.time() - (stale.get('fetched_at') or 0)) / 60)
            logger.warning('实时抓取失败，降级使用 %.0f 分钟前的缓存', age_min)
            print(f'提示：实时抓取失败，改用 {age_min} 分钟前的缓存数据继续（完整性可能略有滞后）。')
            return _decode_cache(stale)
        raise


def _fetch_profile_posts_live(
    sec_uid: str,
    *,
    downloader: Optional[DouyinDownloader] = None,
    limit: int = 60,
) -> tuple[dict, list[ProfilePost]]:
    """实际发起网络抓取（不走缓存），成功后写入缓存。"""
    downloader = downloader or DouyinDownloader()
    try:
        profile = downloader.fetch_user_profile(sec_uid)
    except Exception as exc:
        raise DouyinProfileSyncError(f'获取抖音用户资料失败: {exc}') from exc

    if not profile:
        raise DouyinProfileSyncError(
            '抖音未返回用户资料，通常是 Cookie 失效或主页链接有误，'
            '请在「设置 → 下载器配置」更新抖音 Cookie 后重试'
        )

    try:
        raw_posts = downloader.fetch_user_posts(sec_uid, limit=limit)
    except Exception as exc:
        raise DouyinProfileSyncError(_describe_post_fetch_error(exc)) from exc

    posts = [
        ProfilePost(
            aweme_id=str(p['aweme_id']),
            desc=p.get('desc', ''),
            create_time=p.get('create_time', 0),
            duration=p.get('duration', 0),
            is_top=bool(p.get('is_top')),
        )
        for p in raw_posts
    ]
    _save_cache(sec_uid, profile, posts)
    return profile, posts


def build_plan(
    sec_uid: str,
    *,
    platform: str = DEFAULT_PLATFORM,
    downloader: Optional[DouyinDownloader] = None,
    limit: int = 60,
    refresh: bool = False,
) -> SyncPlan:
    """抓主页 + 比对历史，产出待生成清单（不产生任何写入）。"""
    profile, posts = fetch_profile_posts(
        sec_uid, downloader=downloader, limit=limit, refresh=refresh,
    )
    existing = load_existing_notes(platform)
    missing = [p for p in posts if not _is_covered(existing.get(p.aweme_id))]

    return SyncPlan(
        sec_uid=sec_uid,
        nickname=str(profile.get('nickname') or ''),
        aweme_count=profile.get('aweme_count'),
        posts=posts,
        existing=existing,
        missing=missing,
    )


def _is_covered(note: Optional[ExistingNote]) -> bool:
    """已有任务是否算「已生成笔记」。

    有结果文件 -> 算；失败/取消/可重试且无结果 -> 不算（可重新生成）。
    与 routers/note.py 中 _check_duplicate_response 的口径一致。
    """
    return bool(note and note.has_result)


def resolve_batch(
    project: Optional[str],
    *,
    base_url: str = DEFAULT_BASE_URL,
    timeout: int = 15,
) -> tuple[Optional[str], Optional[str]]:
    """把项目名（或 batch_id）解析为 (batch_id, batch_name)。

    传入 batch_id 时原样返回；传入项目名时按名称精确匹配已有项目，
    匹配不到直接报错——避免静默创建出拼错名字的新项目。
    """
    if not project:
        return None, None

    try:
        response = requests.get(f'{base_url.rstrip("/")}/api/all_batches', timeout=timeout)
        response.raise_for_status()
        batches = (response.json().get('data') or [])
    except Exception as exc:
        raise DouyinProfileSyncError(
            f'读取项目列表失败（后端是否已启动？{base_url}）: {exc}'
        ) from exc

    for batch in batches:
        if batch.get('batch_id') == project:
            return batch.get('batch_id'), batch.get('batch_name')
    for batch in batches:
        if (batch.get('batch_name') or '').strip() == project.strip():
            return batch.get('batch_id'), batch.get('batch_name')

    known = '、'.join(b.get('batch_name') or '' for b in batches) or '（无）'
    raise DouyinProfileSyncError(
        f'找不到项目「{project}」。现有项目：{known}。'
        '如需新建项目，请先在前端新建后再运行本工具'
    )


def resolve_model(
    *,
    base_url: str = DEFAULT_BASE_URL,
    provider_id: Optional[str] = None,
    model_name: Optional[str] = None,
    timeout: int = 15,
) -> tuple[str, str]:
    """确定本次生成使用的 (provider_id, model_name)。

    未显式指定时取当前唯一启用的模型；显式指定时会校验该组合确实已登记，
    否则任务入队后必然失败，不如在这里就拦下来。
    """
    try:
        response = requests.get(f'{base_url.rstrip("/")}/api/model_list', timeout=timeout)
        response.raise_for_status()
        models = (response.json().get('data') or [])
    except Exception as exc:
        raise DouyinProfileSyncError(
            f'读取可用模型失败（后端是否已启动？{base_url}）: {exc}'
        ) from exc

    if not models:
        raise DouyinProfileSyncError('当前没有可用模型，请先在设置中启用供应商并登记模型')

    if provider_id and model_name:
        for model in models:
            if model.get('provider_id') == provider_id and model.get('model_name') == model_name:
                return provider_id, model_name
        available = '、'.join(f"{m.get('provider_id')}/{m.get('model_name')}" for m in models)
        raise DouyinProfileSyncError(
            f'指定模型 {provider_id}/{model_name} 不在可用列表中。可用：{available}'
        )

    model = models[0]
    return model.get('provider_id'), model.get('model_name')


def select_pending(
    plan: SyncPlan,
    *,
    limit: Optional[int] = None,
    newest_first: bool = False,
) -> list[ProfilePost]:
    """从待生成清单里选出本次要提交的子集。

    大规模补更（几百条）一次性全提交会瞬间灌满下载/转写队列，让管道长时间
    被单一博主占满。因此支持 limit 截断 + newest_first 优先补最新作品 ——
    追更场景下「先看上个月的新视频」通常比「先补 2020 年的老视频」更有价值。
    """
    posts = list(plan.missing)
    if newest_first:
        posts.sort(key=lambda p: p.create_time or 0, reverse=True)
    if limit is not None and limit > 0:
        posts = posts[:limit]
    return posts


def submit_missing(
    plan: SyncPlan,
    *,
    provider_id: str,
    model_name: str,
    style: str = 'detailed',
    batch_id: Optional[str] = None,
    batch_name: Optional[str] = None,
    base_url: str = DEFAULT_BASE_URL,
    timeout: int = 60,
    posts: Optional[list[ProfilePost]] = None,
) -> dict:
    """把计划中的缺失视频批量提交为笔记任务。

    `posts` 可显式指定要提交的子集（配合 select_pending 做分批），
    省略时提交全部缺失项。

    走与前端相同的 /api/generate_notes_batch，任务进入正常的三阶段管道。
    duplicate_strategy=skip：本工具的目标就是「只补缺失」，即便并发场景下
    刚被别人生成过，也直接跳过而不是重复生成。
    """
    targets = list(posts) if posts is not None else list(plan.missing)
    if not targets:
        return {'submitted': [], 'rejected': [], 'batch_id': batch_id, 'batch_name': batch_name}

    payload = {
        'video_urls': [p.canonical_url for p in targets],
        'platform': DEFAULT_PLATFORM,
        'quality': 'fast',
        'model_name': model_name,
        'provider_id': provider_id,
        'format': [],
        'style': style,
        'screenshot': False,
        'link': False,
        'video_understanding': False,
        'duplicate_strategy': 'skip',
    }
    if batch_id:
        payload['batch_id'] = batch_id
    if batch_name:
        payload['batch_name'] = batch_name

    try:
        response = requests.post(
            f'{base_url.rstrip("/")}/api/generate_notes_batch',
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        body = response.json()
    except Exception as exc:
        raise DouyinProfileSyncError(f'提交生成任务失败: {exc}') from exc

    if body.get('code') not in (0, None):
        raise DouyinProfileSyncError(f"提交生成任务失败: {body.get('msg') or body}")

    data = body.get('data') or {}
    tasks = data.get('tasks') or []
    return {
        'submitted': [t for t in tasks if t.get('code') == 0],
        'rejected': [t for t in tasks if t.get('code') != 0],
        'batch_id': data.get('batch_id') or batch_id,
        'batch_name': data.get('batch_name') or batch_name,
    }


def format_plan(
    plan: SyncPlan,
    *,
    limit: int = 20,
    batch_id: Optional[str] = None,
    preview: Optional[list[ProfilePost]] = None,
) -> str:
    """把计划渲染成人类可读的多行文本（CLI 与日志共用）。

    `preview` 用于展示「本次实际会提交的那批」：配合 --max-submit 时，
    若直接展示全量 missing，用户会看不出截取是否生效（顺序/条数都对不上）。
    """
    lines = []
    header = f'主页：{plan.nickname or "(未知)"}'
    if plan.aweme_count is not None:
        header += f'  作品数：{plan.aweme_count}'
    lines.append(header)
    lines.append(f'抓取到作品：{len(plan.posts)}  已有笔记：{plan.covered}  待生成：{len(plan.missing)}')

    shown = preview if preview is not None else plan.missing
    if shown:
        truncated = len(shown) < len(plan.missing)
        title = '本次将提交' if truncated else '待生成视频'
        lines.append('')
        lines.append(f'{title}（{len(shown)} 条）：' if not truncated else f'{title}（{len(shown)}/{len(plan.missing)} 条）：')
        for index, post in enumerate(shown[:limit], 1):
            date = post.created_text()
            lines.append(f'  {index:3d}. {post.aweme_id}  {date}  {post.title[:50]}')
        if len(shown) > limit:
            lines.append(f'  ... 其余 {len(shown) - limit} 条略')

    stale = plan.stale_in_project(batch_id)
    if stale:
        lines.append('')
        lines.append(
            f'提示：本项目另有 {len(stale)} 条笔记的视频已不在该主页（可能已删除、设为私密，或本就不属于该博主）：'
        )
        for note in stale[:5]:
            lines.append(f'  - {note.video_id}  {(note.title or "")[:40]}')
        if len(stale) > 5:
            lines.append(f'  ... 其余 {len(stale) - 5} 条略')

    return '\n'.join(lines)
