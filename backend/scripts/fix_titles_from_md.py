"""把 DB 里的脏标题（带 hashtag/@mention/desc/占位符）替换为
Markdown 正文里 GPT 生成的干净大标题，或清洗 hashtag 后回填。

运行：backend/.venv/bin/python3 backend/scripts/fix_titles_from_md.py
"""
import os, json, re, sys, sqlite3, datetime

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DB_PATH = os.path.join(REPO_ROOT, 'bili_note.db')
STATUS_DIR = os.path.join(REPO_ROOT, 'backend', 'json_results')

def clean_db_title(t: str) -> str:
    t = (t or '').strip()
    if not t: return ''
    t = re.sub(r'#\s*\S+', '', t)
    t = re.sub(r'@[\w\u4e00-\u9fff]+', '', t)
    t = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf]', '', t, flags=re.UNICODE)
    t = re.sub(r'[\r\n\t]+', ' ', t)
    t = re.sub(r'[ \t]+', ' ', t)
    return t.strip(' ，。！？、·—_「」【】（）()[]《》').strip()

def pick_md_heading(md: str) -> str:
    if not md: return ''
    skip = {'目录','前言','总结','结论','笔记','摘要','','目录 摘要 前言 总结'}
    for line in md.split('\n'):
        line = line.strip()
        if not line.startswith('# ') or len(line) < 4:
            continue
        title = line[2:].strip()
        if title in skip:
            continue
        if re.search(r'^视频笔记：\s*\d{10,}', title):
            continue
        if re.search(r'^\d{15,}$', title):
            continue
        return title
    return ''

def title_is_bad(t: str) -> bool:
    if not t: return True
    if re.search(r'^视频笔记：\s*\d{10,}', t): return True
    if re.search(r'\d{15,}', t.strip()): return True
    if '#' in t and len(t) > 20: return True
    if '@' in t: return True
    if '\n' in t: return True
    if len(t) > 120: return True
    return False

def main():
    print(f"DB:   {DB_PATH}")
    print(f"JSON: {STATUS_DIR}")
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    rows = db.execute("SELECT task_id, title FROM video_tasks").fetchall()
    print(f"共 {len(rows)} 条任务\n")

    updated_md = []
    updated_clean = []
    audio_json_updates = 0
    skipped_good = 0
    errors = 0

    for r in rows:
        tid = r['task_id']
        db_t = (r['title'] or '').strip()
        jp = os.path.join(STATUS_DIR, f'{tid}.json')
        md_h = ''
        audio_obj = None

        if os.path.exists(jp):
            try:
                with open(jp) as f:
                    audio_obj = json.load(f)
                md_h = pick_md_heading(audio_obj.get('markdown') or '')
            except Exception as e:
                print(f"  ⚠️  json 解析失败 {tid[:12]}: {e}")
                errors += 1
                continue

        new_title = None

        if md_h and (title_is_bad(db_t) or len(md_h) + 2 < len(db_t)):
            new_title = md_h
            updated_md.append((tid, db_t[:50], new_title))
        else:
            cleaned = clean_db_title(db_t)
            if cleaned and cleaned != db_t:
                new_title = cleaned
                updated_clean.append((tid, db_t[:50], new_title))

        if not new_title:
            skipped_good += 1
            continue

        # 写 DB
        try:
            db.execute("UPDATE video_tasks SET title = ? WHERE task_id = ?", (new_title, tid))
        except Exception as e:
            print(f"  ⚠️  DB 更新失败 {tid[:12]}: {e}")
            errors += 1
            continue

        # 同步 audio_json
        if audio_obj is not None:
            changed = False
            am = audio_obj.setdefault('audio_meta', {})
            if am.get('title') != new_title:
                am['title'] = new_title
                changed = True
            # 顶层 title 也同步（如果存在）
            if audio_obj.get('title') != new_title and 'title' in audio_obj:
                audio_obj['title'] = new_title
                changed = True
            if changed:
                try:
                    with open(jp, 'w') as f:
                        json.dump(audio_obj, f, ensure_ascii=False, indent=2)
                    audio_json_updates += 1
                except Exception as e:
                    print(f"  ⚠️  json 写回失败 {tid[:12]}: {e}")

    db.commit()
    db.close()

    print(f"✅ 用 MD heading 替换 DB title:  {len(updated_md)} 条")
    print(f"✅ 清洗 DB title（hashtag/@）:    {len(updated_clean)} 条")
    print(f"✅ audio_json title 同步更新:     {audio_json_updates} 条")
    print(f"ℹ️  标题干净跳过:                {skipped_good} 条")
    print(f"⚠️  错误:                        {errors} 条")

    print("\n--- MD heading 替换（抽样前 8 条）---")
    for tid, old, new in updated_md[:8]:
        print(f"  {tid[:12]}")
        print(f"    DB : {old}")
        print(f"    ->  {new}")

if __name__ == '__main__':
    main()
