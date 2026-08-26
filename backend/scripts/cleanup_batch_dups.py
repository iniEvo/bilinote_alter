"""一次性清理脚本：去除批次内因重试 bug 产生的重复任务行。

背景：_build_retry_request 曾用 setdefault 覆盖 task_id，导致 request_payload 残留的
task_id=null 未被数据库行主键覆盖，每次「重试失败项」都会插入一条新行。结果同一 video_id
在 video_tasks 表里累积 2~5 行。

本脚本对指定批次，按 video_id 分组后保留「状态最优」一行（SUCCESS > 进行中 > 其他），
删除其余冗余行及其产物文件（json_results / note_results 下按 task_id 命名的文件）。

用法：
  python backend/scripts/cleanup_batch_dups.py --batch-id <uuid>          # 默认 dry-run
  python backend/scripts/cleanup_batch_dups.py --batch-id <uuid> --apply  # 真正删除
"""
import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.utils.output_paths import (  # noqa: E402
    audio_json_path,
    markdown_status_path,
    note_json_path,
    note_markdown_path,
    task_status_path,
    transcript_json_path,
)

DB_PATH = BACKEND_ROOT.parent / 'bili_note.db'  # 与 app.db.engine 默认一致

IN_PROGRESS = {'PENDING', 'PARSING', 'DOWNLOADING', 'TRANSCRIBING',
               'SUMMARIZING', 'FORMATTING', 'SAVING'}


def status_rank(status: str | None) -> int:
    if status == 'SUCCESS':
        return 3
    if status in IN_PROGRESS:
        return 2
    return 1  # FAILED / CANCELED / PAUSED / 未知


def read_status(task_id: str) -> str | None:
    try:
        data = json.loads(task_status_path(task_id).read_text(encoding='utf-8'))
        return data.get('status')
    except Exception:
        return None


def read_note_title(task_id: str) -> str | None:
    try:
        data = json.loads(note_json_path(task_id).read_text(encoding='utf-8'))
        return (data.get('audio_meta') or {}).get('title')
    except Exception:
        return None


def files_for(task_id: str, title: str | None = None) -> list[Path]:
    return [
        task_status_path(task_id),
        note_json_path(task_id),
        audio_json_path(task_id),
        transcript_json_path(task_id),
        markdown_status_path(task_id),
        note_markdown_path(task_id),
        note_markdown_path(task_id, title),
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch-id', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        'SELECT id, video_id, task_id, title, platform FROM video_tasks WHERE batch_id=? ORDER BY id',
        (args.batch_id,),
    )
    rows = cur.fetchall()

    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        d = dict(r)
        d['status'] = read_status(d['task_id'])
        d['status'] = d['status'] or None
        groups[d['video_id']].append(d)

    to_delete: list[dict] = []
    keep_plan = []
    for video_id, members in groups.items():
        members_sorted = sorted(members, key=lambda m: (status_rank(m['status']), m['id']), reverse=True)
        keep = members_sorted[0]
        dupes = members_sorted[1:]
        keep_plan.append((video_id, keep, dupes))
        to_delete.extend(dupes)

    print(f'批次 {args.batch_id}')
    print(f'  行总数={len(rows)}  唯一 video_id={len(groups)}  冗余行={len(to_delete)}')
    print(f'  模式={"APPLY（真正删除）" if args.apply else "DRY-RUN（仅预览）"}')
    print()

    if not to_delete:
        print('  没有冗余行，无需清理。')
        conn.close()
        return 0

    # 优先级完善的显示：仅展示有冗余的组
    dup_groups = [g for g in keep_plan if g[2]]
    print(f'  冗余组（{len(dup_groups)} 个），每组「★=保留 / -=删除」：')
    for video_id, keep, dupes in dup_groups:
        print(f'    video={video_id}: ★ {keep["status"] or "?"}(row {keep["id"]}, {keep["task_id"][:8]})'
              + ''.join(f'   - {d["status"] or "?"}(row {d["id"]}, {d["task_id"][:8]})' for d in dupes))

    if not args.apply:
        print()
        print('  DRY-RUN 结束。确认无误后加 --apply 执行。')
        conn.close()
        return 0

    # 真正删除：先删文件，再删 DB 行（文件删失败不影响 DB 记录继续删除）
    deleted_files = 0
    deleted_db = 0
    for d in to_delete:
        title = read_note_title(d['task_id']) or d.get('title')
        for p in files_for(d['task_id'], title):
            try:
                if p.exists():
                    p.unlink()
                    deleted_files += 1
            except Exception as exc:
                print(f'    [warn] 删除文件失败 {p}: {exc}')

        cur.execute('DELETE FROM video_tasks WHERE task_id=?', (d['task_id'],))
        if cur.rowcount > 0:
            deleted_db += 1
        else:
            print(f'    [warn] 未找到 DB 行 task_id={d["task_id"]}')
    conn.commit()

    cur.execute('SELECT COUNT(*) FROM video_tasks WHERE batch_id=?', (args.batch_id,))
    remaining = cur.fetchone()[0]
    conn.close()

    print()
    print(f'  删除完成：DB 行 {deleted_db}，文件 {deleted_files}')
    print(f'  清理后批次行数={remaining}（应等于唯一 video_id={len(groups)}）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())