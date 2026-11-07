import json
import pathlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_ROOT = str(ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.services import douyin_profile_sync as sync  # noqa: E402


def _row(task_id, video_id, platform='douyin', batch_id=None, title=None, batch_name=None):
    return SimpleNamespace(
        task_id=task_id,
        video_id=video_id,
        platform=platform,
        batch_id=batch_id,
        batch_name=batch_name,
        title=title,
    )


class TestSecUidExtraction(unittest.TestCase):
    def test_extracts_from_full_profile_url(self):
        from app.downloaders.douyin_downloader import DouyinDownloader

        url = 'https://www.douyin.com/user/MS4wLjABAAAAabc-def_123?from_tab_name=main'
        self.assertEqual(DouyinDownloader.extract_sec_uid(url), 'MS4wLjABAAAAabc-def_123')

    def test_extracts_bare_sec_uid(self):
        from app.downloaders.douyin_downloader import DouyinDownloader

        self.assertEqual(
            DouyinDownloader.extract_sec_uid('MS4wLjABAAAAxyz789'),
            'MS4wLjABAAAAxyz789',
        )

    def test_returns_empty_for_video_url(self):
        from app.downloaders.douyin_downloader import DouyinDownloader

        self.assertEqual(
            DouyinDownloader.extract_sec_uid('https://www.douyin.com/video/7693912432338537774'),
            '',
        )

    def test_returns_empty_for_blank(self):
        from app.downloaders.douyin_downloader import DouyinDownloader

        self.assertEqual(DouyinDownloader.extract_sec_uid(''), '')
        self.assertEqual(DouyinDownloader.extract_sec_uid(None), '')


class TestLoadExistingNotes(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.json_dir = pathlib.Path(self.tmpdir.name)

    def tearDown(self):
        self.tmpdir.cleanup()

    def _patch_paths(self, result_tasks=(), status_map=None):
        """把结果/状态文件路径指到临时目录，用真实文件存在性驱动判定。"""
        status_map = status_map or {}

        def json_path(task_id):
            return self.json_dir / f'{task_id}.json'

        def status_path(task_id):
            return self.json_dir / f'{task_id}.status.json'

        for task_id in result_tasks:
            json_path(task_id).write_text(json.dumps({'markdown': 'x'}), encoding='utf-8')
        for task_id, status in status_map.items():
            status_path(task_id).write_text(json.dumps({'status': status}), encoding='utf-8')

        return patch.multiple(
            sync,
            note_json_path=json_path,
            task_status_path=status_path,
        )

    def test_groups_by_video_id_and_prefers_row_with_result(self):
        rows = [
            _row('task-old', '111', batch_id='b1'),
            _row('task-new', '111', batch_id='b1'),
            _row('task-other', '222', batch_id='b2'),
        ]
        with patch.object(sync, 'list_all_tasks', return_value=rows), \
             self._patch_paths(result_tasks=('task-new',), status_map={'task-old': 'FAILED'}):
            grouped = sync.load_existing_notes()

        self.assertEqual(set(grouped), {'111', '222'})
        # 有结果的那一行胜出
        self.assertTrue(grouped['111'].has_result)
        self.assertEqual(grouped['111'].task_id, 'task-new')
        self.assertFalse(grouped['222'].has_result)

    def test_filters_by_platform(self):
        rows = [
            _row('t1', '111', platform='douyin'),
            _row('t2', 'BV1xx', platform='bilibili'),
        ]
        with patch.object(sync, 'list_all_tasks', return_value=rows), \
             self._patch_paths():
            grouped = sync.load_existing_notes('douyin')

        self.assertEqual(set(grouped), {'111'})

    def test_skips_rows_without_video_id(self):
        rows = [_row('t1', ''), _row('t2', '333')]
        with patch.object(sync, 'list_all_tasks', return_value=rows), \
             self._patch_paths():
            grouped = sync.load_existing_notes()

        self.assertEqual(set(grouped), {'333'})

    def test_failed_without_result_is_not_covered(self):
        rows = [_row('t1', '999')]
        with patch.object(sync, 'list_all_tasks', return_value=rows), \
             self._patch_paths(status_map={'t1': 'FAILED'}):
            grouped = sync.load_existing_notes()

        self.assertFalse(grouped['999'].has_result)
        self.assertEqual(grouped['999'].status, 'FAILED')


class TestIsCovered(unittest.TestCase):
    def test_none_is_not_covered(self):
        self.assertFalse(sync._is_covered(None))

    def test_without_result_is_not_covered(self):
        note = sync.ExistingNote('t', '1', 'FAILED', None, None, None, has_result=False)
        self.assertFalse(sync._is_covered(note))

    def test_with_result_is_covered(self):
        note = sync.ExistingNote('t', '1', 'SUCCESS', None, None, None, has_result=True)
        self.assertTrue(sync._is_covered(note))


class TestBuildPlan(unittest.TestCase):
    def _post(self, aweme_id, desc='desc', ts=1700000000):
        return {
            'aweme_id': aweme_id,
            'desc': desc,
            'create_time': ts,
            'duration': 10,
            'is_top': False,
        }

    def test_missing_only_contains_ungenerated_posts(self):
        profile = {'nickname': '测试博主', 'aweme_count': 3}

        def fake_fetch(sec_uid, **kwargs):
            return profile, [
                sync.ProfilePost(**self._post('111')),
                sync.ProfilePost(**self._post('222')),
                sync.ProfilePost(**self._post('333')),
            ]

        existing = {
            '111': sync.ExistingNote('t1', '111', 'SUCCESS', 'b1', 'P', None, has_result=True),
            # 失败且无结果 -> 应视为未生成
            '222': sync.ExistingNote('t2', '222', 'FAILED', 'b1', 'P', None, has_result=False),
        }

        with patch.object(sync, 'fetch_profile_posts', side_effect=fake_fetch), \
             patch.object(sync, 'load_existing_notes', return_value=existing):
            plan = sync.build_plan('uid')

        self.assertEqual([p.aweme_id for p in plan.missing], ['222', '333'])
        self.assertEqual(plan.covered, 1)
        self.assertEqual(plan.nickname, '测试博主')
        self.assertEqual(plan.aweme_count, 3)

    def test_missing_empty_when_all_generated(self):
        def fake_fetch(sec_uid, **kwargs):
            return {'nickname': 'x'}, [sync.ProfilePost(**self._post('111'))]

        existing = {
            '111': sync.ExistingNote('t1', '111', 'SUCCESS', None, None, None, has_result=True),
        }
        with patch.object(sync, 'fetch_profile_posts', side_effect=fake_fetch), \
             patch.object(sync, 'load_existing_notes', return_value=existing):
            plan = sync.build_plan('uid')

        self.assertEqual(plan.missing, [])
        self.assertEqual(plan.covered, 1)


class TestStaleInProject(unittest.TestCase):
    def test_returns_project_notes_absent_from_profile(self):
        plan = sync.SyncPlan(
            sec_uid='uid',
            posts=[sync.ProfilePost('111')],
            existing={
                '111': sync.ExistingNote('t1', '111', 'SUCCESS', 'b1', 'P', 't', has_result=True),
                '999': sync.ExistingNote('t2', '999', 'SUCCESS', 'b1', 'P', 'gone', has_result=True),
                # 属于其他项目，不应计入
                '888': sync.ExistingNote('t3', '888', 'SUCCESS', 'b2', 'Q', 'other', has_result=True),
            },
        )
        stale = plan.stale_in_project('b1')
        self.assertEqual([n.video_id for n in stale], ['999'])

    def test_empty_without_batch_id(self):
        plan = sync.SyncPlan(sec_uid='uid', posts=[], existing={})
        self.assertEqual(plan.stale_in_project(None), [])


class TestResolveBatch(unittest.TestCase):
    def test_resolves_by_name(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'data': [{'batch_id': 'b1', 'batch_name': '后期钉 杰瑞'}],
        }
        with patch.object(sync.requests, 'get', return_value=response):
            self.assertEqual(sync.resolve_batch('后期钉 杰瑞'), ('b1', '后期钉 杰瑞'))

    def test_resolves_by_batch_id(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'data': [{'batch_id': 'b1', 'batch_name': 'X'}]}
        with patch.object(sync.requests, 'get', return_value=response):
            self.assertEqual(sync.resolve_batch('b1'), ('b1', 'X'))

    def test_unknown_name_raises_with_existing_names(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'data': [{'batch_id': 'b1', 'batch_name': '已知项目'}]}
        with patch.object(sync.requests, 'get', return_value=response):
            with self.assertRaises(sync.DouyinProfileSyncError) as ctx:
                sync.resolve_batch('拼错的项目')

        self.assertIn('找不到项目', str(ctx.exception))
        self.assertIn('已知项目', str(ctx.exception))

    def test_empty_project_returns_none(self):
        self.assertEqual(sync.resolve_batch(''), (None, None))


class TestResolveModel(unittest.TestCase):
    def test_falls_back_to_first_model(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'data': [{'provider_id': 'p1', 'model_name': 'm1'}, {'provider_id': 'p2', 'model_name': 'm2'}],
        }
        with patch.object(sync.requests, 'get', return_value=response):
            self.assertEqual(sync.resolve_model(), ('p1', 'm1'))

    def test_validates_explicit_pair(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'data': [{'provider_id': 'p1', 'model_name': 'm1'}]}
        with patch.object(sync.requests, 'get', return_value=response):
            self.assertEqual(sync.resolve_model(provider_id='p1', model_name='m1'), ('p1', 'm1'))

    def test_rejects_unknown_pair(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'data': [{'provider_id': 'p1', 'model_name': 'm1'}]}
        with patch.object(sync.requests, 'get', return_value=response):
            with self.assertRaises(sync.DouyinProfileSyncError):
                sync.resolve_model(provider_id='p9', model_name='nope')

    def test_raises_when_no_models(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'data': []}
        with patch.object(sync.requests, 'get', return_value=response):
            with self.assertRaises(sync.DouyinProfileSyncError):
                sync.resolve_model()


class TestSubmitMissing(unittest.TestCase):
    def test_skips_submission_when_nothing_missing(self):
        plan = sync.SyncPlan(sec_uid='uid', missing=[])
        with patch.object(sync.requests, 'post') as post:
            result = sync.submit_missing(plan, provider_id='p', model_name='m')

        post.assert_not_called()
        self.assertEqual(result['submitted'], [])

    def test_payload_carries_batch_and_style(self):
        plan = sync.SyncPlan(
            sec_uid='uid',
            missing=[sync.ProfilePost('111'), sync.ProfilePost('222')],
        )
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'code': 0,
            'data': {
                'batch_id': 'b1',
                'batch_name': 'P',
                'tasks': [
                    {'task_id': 't1', 'video_url': 'u1', 'code': 0},
                    {'task_id': 't2', 'video_url': 'u2', 'code': 409, 'msg': 'duplicate'},
                ],
            },
        }
        with patch.object(sync.requests, 'post', return_value=response) as post:
            result = sync.submit_missing(
                plan,
                provider_id='p1',
                model_name='m1',
                style='detailed',
                batch_id='b1',
                batch_name='P',
            )

        payload = post.call_args.kwargs['json']
        self.assertEqual(payload['video_urls'], [
            'https://www.douyin.com/video/111',
            'https://www.douyin.com/video/222',
        ])
        self.assertEqual(payload['style'], 'detailed')
        self.assertEqual(payload['batch_id'], 'b1')
        self.assertEqual(payload['batch_name'], 'P')
        self.assertEqual(payload['platform'], 'douyin')
        # 本工具只补缺失，遇到并发重复应跳过而非重复生成
        self.assertEqual(payload['duplicate_strategy'], 'skip')
        self.assertFalse(payload['screenshot'])
        self.assertFalse(payload['link'])

        self.assertEqual(len(result['submitted']), 1)
        self.assertEqual(len(result['rejected']), 1)

    def test_raises_on_error_code(self):
        plan = sync.SyncPlan(sec_uid='uid', missing=[sync.ProfilePost('111')])
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'code': 300102, 'msg': '转写模型未就绪'}
        with patch.object(sync.requests, 'post', return_value=response):
            with self.assertRaises(sync.DouyinProfileSyncError) as ctx:
                sync.submit_missing(plan, provider_id='p', model_name='m')

        self.assertIn('转写模型未就绪', str(ctx.exception))


class TestFetchProfilePosts(unittest.TestCase):
    """抓取与映射逻辑。

    这里统一把缓存指到临时目录：否则测试会用真实的缓存目录，
    既会污染用户环境，也会让用例之间互相串味（同一个假 sec_uid
    命中上一轮写的缓存，导致本该失败的用例拿到旧数据）。
    """

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.cache_dir = pathlib.Path(self.tmpdir.name)
        self._cache_patch = patch.object(
            sync, '_cache_path', side_effect=lambda uid: self.cache_dir / f'{uid}.json',
        )
        self._cache_patch.start()

    def tearDown(self):
        self._cache_patch.stop()
        self.tmpdir.cleanup()

    def test_raises_on_empty_profile(self):
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {}
        with self.assertRaises(sync.DouyinProfileSyncError) as ctx:
            sync.fetch_profile_posts('uid', downloader=downloader, cache_ttl=0)

        self.assertIn('Cookie', str(ctx.exception))

    def test_raises_when_sec_uid_empty(self):
        with self.assertRaises(sync.DouyinProfileSyncError):
            sync.fetch_profile_posts('')

    def test_maps_raw_posts(self):
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N', 'aweme_count': 1}
        downloader.fetch_user_posts.return_value = [
            {'aweme_id': 111, 'desc': 'd', 'create_time': 1700000000, 'duration': 5, 'is_top': True},
        ]
        profile, posts = sync.fetch_profile_posts('uid', downloader=downloader, cache_ttl=0)

        self.assertEqual(profile['nickname'], 'N')
        self.assertEqual(posts[0].aweme_id, '111')
        self.assertEqual(posts[0].canonical_url, 'https://www.douyin.com/video/111')
        self.assertTrue(posts[0].is_top)


class TestFormatPlan(unittest.TestCase):
    def test_reports_counts_and_missing_list(self):
        plan = sync.SyncPlan(
            sec_uid='uid',
            nickname='博主',
            aweme_count=2,
            posts=[sync.ProfilePost('111'), sync.ProfilePost('222', desc='新视频标题')],
            missing=[sync.ProfilePost('222', desc='新视频标题', create_time=1700000000)],
        )
        text = sync.format_plan(plan)

        self.assertIn('博主', text)
        self.assertIn('抓取到作品：2  已有笔记：1  待生成：1', text)
        self.assertIn('222', text)
        self.assertIn('新视频标题', text)

    def test_truncates_long_missing_list(self):
        plan = sync.SyncPlan(
            sec_uid='uid',
            posts=[sync.ProfilePost(str(i)) for i in range(30)],
            missing=[sync.ProfilePost(str(i)) for i in range(30)],
        )
        text = sync.format_plan(plan, limit=10)
        self.assertIn('其余 20 条略', text)


class TestSelectPending(unittest.TestCase):
    def _plan(self, posts):
        return sync.SyncPlan(sec_uid='uid', posts=posts, missing=list(posts))

    def test_returns_all_when_no_limit(self):
        posts = [sync.ProfilePost('1', create_time=100), sync.ProfilePost('2', create_time=200)]
        self.assertEqual(len(sync.select_pending(self._plan(posts))), 2)

    def test_limit_truncates(self):
        posts = [sync.ProfilePost(str(i), create_time=i) for i in range(10)]
        self.assertEqual(len(sync.select_pending(self._plan(posts), limit=3)), 3)

    def test_newest_first_orders_by_create_time_desc(self):
        posts = [
            sync.ProfilePost('old', create_time=100),
            sync.ProfilePost('new', create_time=300),
            sync.ProfilePost('mid', create_time=200),
        ]
        selected = sync.select_pending(self._plan(posts), limit=2, newest_first=True)
        self.assertEqual([p.aweme_id for p in selected], ['new', 'mid'])

    def test_default_order_preserves_profile_order(self):
        """不加 newest_first 时保持主页返回顺序（通常是置顶优先 + 时间倒序）。"""
        posts = [
            sync.ProfilePost('first', create_time=100),
            sync.ProfilePost('second', create_time=300),
        ]
        selected = sync.select_pending(self._plan(posts), limit=1)
        self.assertEqual([p.aweme_id for p in selected], ['first'])

    def test_zero_limit_means_unlimited(self):
        posts = [sync.ProfilePost(str(i), create_time=i) for i in range(5)]
        self.assertEqual(len(sync.select_pending(self._plan(posts), limit=0)), 5)


class TestSubmitMissingSubset(unittest.TestCase):
    def test_posts_argument_limits_payload(self):
        """显式传 posts 时只提交该子集（配合分批使用）。"""
        plan = sync.SyncPlan(
            sec_uid='uid',
            missing=[sync.ProfilePost('111'), sync.ProfilePost('222'), sync.ProfilePost('333')],
        )
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {'code': 0, 'data': {'tasks': [{'task_id': 't', 'code': 0}]}}

        with patch.object(sync.requests, 'post', return_value=response) as post:
            sync.submit_missing(
                plan,
                provider_id='p',
                model_name='m',
                posts=[plan.missing[1]],
            )

        payload = post.call_args.kwargs['json']
        self.assertEqual(payload['video_urls'], ['https://www.douyin.com/video/222'])

    def test_empty_subset_skips_request(self):
        plan = sync.SyncPlan(sec_uid='uid', missing=[sync.ProfilePost('111')])
        with patch.object(sync.requests, 'post') as post:
            result = sync.submit_missing(plan, provider_id='p', model_name='m', posts=[])

        post.assert_not_called()
        self.assertEqual(result['submitted'], [])


class TestFormatPlanPreview(unittest.TestCase):
    def test_preview_shows_subset_and_ratio(self):
        plan = sync.SyncPlan(
            sec_uid='uid',
            posts=[sync.ProfilePost(str(i)) for i in range(10)],
            missing=[sync.ProfilePost(str(i)) for i in range(10)],
        )
        preview = [sync.ProfilePost('9'), sync.ProfilePost('8')]
        text = sync.format_plan(plan, preview=preview)

        self.assertIn('本次将提交（2/10 条）', text)
        self.assertIn('9', text)

    def test_without_preview_shows_full_missing(self):
        plan = sync.SyncPlan(
            sec_uid='uid', posts=[sync.ProfilePost('1')], missing=[sync.ProfilePost('1')],
        )
        text = sync.format_plan(plan)
        self.assertIn('待生成视频（1 条）', text)


class TestDescribePostFetchError(unittest.TestCase):
    def test_403_mentions_rate_limit_and_cookie(self):
        msg = sync._describe_post_fetch_error(
            Exception('403 Client Error: Forbidden for url: https://www.douyin.com/aweme/...'),
        )
        self.assertIn('IP 限流', msg)
        self.assertIn('Cookie', msg)

    def test_403_fallback_also_matches_forbidden_word(self):
        msg = sync._describe_post_fetch_error(Exception('Forbidden'))
        self.assertIn('403', msg)

    def test_timeout_message(self):
        msg = sync._describe_post_fetch_error(Exception('HTTPSConnectionPool timed out'))
        self.assertIn('超时', msg)

    def test_unknown_error_keeps_detail(self):
        msg = sync._describe_post_fetch_error(Exception('something weird'))
        self.assertIn('something weird', msg)

    def test_fetch_profile_posts_wraps_403_with_hint(self):
        """403 必须向上冒泡为带排查指引的 DouyinProfileSyncError。"""
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N'}
        downloader.fetch_user_posts.side_effect = Exception('403 Client Error: Forbidden')

        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(sync, '_cache_path', side_effect=lambda uid: pathlib.Path(tmp) / f'{uid}.json'):
            with self.assertRaises(sync.DouyinProfileSyncError) as ctx:
                sync.fetch_profile_posts('uid', downloader=downloader, cache_ttl=0)

        self.assertIn('IP 限流', str(ctx.exception))


class TestProfileCache(unittest.TestCase):
    """主页抓取缓存：降低重复抓取带来的风控风险。"""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.cache_dir = pathlib.Path(self.tmpdir.name)

    def tearDown(self):
        self.tmpdir.cleanup()

    def _patch_cache(self):
        return patch.object(sync, '_cache_path', side_effect=lambda uid: self.cache_dir / f'{uid}.json')

    def test_second_call_hits_cache_and_skips_fetch(self):
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N'}
        downloader.fetch_user_posts.return_value = [
            {'aweme_id': '111', 'desc': 'd', 'create_time': 1, 'duration': 1, 'is_top': False},
        ]

        with self._patch_cache():
            sync.fetch_profile_posts('u1', downloader=downloader, refresh=True)
            self.assertEqual(downloader.fetch_user_posts.call_count, 1)

            # 第二次：TTL 内应命中缓存，不再调用网络
            profile, posts = sync.fetch_profile_posts('u1', downloader=downloader)
            self.assertEqual(downloader.fetch_user_posts.call_count, 1, '第二次不应再抓取')
            self.assertEqual(profile['nickname'], 'N')
            self.assertEqual([p.aweme_id for p in posts], ['111'])

    def test_refresh_bypasses_cache(self):
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N'}
        downloader.fetch_user_posts.return_value = []

        with self._patch_cache():
            sync.fetch_profile_posts('u2', downloader=downloader, refresh=True)
            sync.fetch_profile_posts('u2', downloader=downloader, refresh=True)
            self.assertEqual(downloader.fetch_user_posts.call_count, 2, 'refresh 应强制重抓')

    def test_expired_cache_triggers_refetch(self):
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N'}
        downloader.fetch_user_posts.return_value = [
            {'aweme_id': '111', 'desc': 'd', 'create_time': 1, 'duration': 1, 'is_top': False},
        ]

        with self._patch_cache():
            sync.fetch_profile_posts('u3', downloader=downloader, refresh=True)
            # cache_ttl=0 等价于视为过期
            sync.fetch_profile_posts('u3', downloader=downloader, cache_ttl=0)
            self.assertEqual(downloader.fetch_user_posts.call_count, 2)

    def test_falls_back_to_stale_cache_on_403(self):
        """抓取遇到风控时，用历史缓存降级，而不是让整个流程中断。"""
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N'}
        downloader.fetch_user_posts.return_value = [
            {'aweme_id': '111', 'desc': 'd', 'create_time': 1, 'duration': 1, 'is_top': False},
        ]

        with self._patch_cache():
            # 先成功抓一次，写入缓存
            sync.fetch_profile_posts('u4', downloader=downloader, refresh=True)

            # 再让抓取失败（模拟 403），且缓存已过期
            downloader.fetch_user_posts.side_effect = Exception('403 Client Error: Forbidden')
            profile, posts = sync.fetch_profile_posts('u4', downloader=downloader, cache_ttl=0)

        self.assertEqual([p.aweme_id for p in posts], ['111'], '应降级使用过期缓存')

    def test_no_cache_and_failure_raises(self):
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N'}
        downloader.fetch_user_posts.side_effect = Exception('403 Client Error: Forbidden')

        with self._patch_cache():
            with self.assertRaises(sync.DouyinProfileSyncError):
                sync.fetch_profile_posts('u5', downloader=downloader, refresh=True)

    def test_cache_disabled_by_zero_ttl(self):
        downloader = Mock()
        downloader.fetch_user_profile.return_value = {'nickname': 'N'}
        downloader.fetch_user_posts.return_value = []

        with self._patch_cache():
            sync.fetch_profile_posts('u6', downloader=downloader, cache_ttl=0)
            sync.fetch_profile_posts('u6', downloader=downloader, cache_ttl=0)
            self.assertEqual(downloader.fetch_user_posts.call_count, 2)


class TestCliParser(unittest.TestCase):
    def test_parser_defaults_are_dry_run(self):
        from scripts.sync_douyin_profile_notes import build_parser

        args = build_parser().parse_args(['--url', 'uid'])
        self.assertFalse(args.apply)
        self.assertEqual(args.style, 'detailed')
        self.assertEqual(args.limit, 60)

    def test_parser_apply_and_project(self):
        from scripts.sync_douyin_profile_notes import build_parser

        args = build_parser().parse_args(['--url', 'uid', '--project', 'P', '--apply'])
        self.assertTrue(args.apply)
        self.assertEqual(args.project, 'P')

    def test_parser_batch_controls_default_disabled(self):
        from scripts.sync_douyin_profile_notes import build_parser

        args = build_parser().parse_args(['--url', 'uid'])
        self.assertEqual(args.max_submit, 0, '默认不限量')
        self.assertFalse(args.newest_first)

    def test_parser_accepts_max_submit_and_newest_first(self):
        from scripts.sync_douyin_profile_notes import build_parser

        args = build_parser().parse_args(
            ['--url', 'uid', '--max-submit', '5', '--newest-first', '--apply'],
        )
        self.assertEqual(args.max_submit, 5)
        self.assertTrue(args.newest_first)


if __name__ == '__main__':
    unittest.main()
