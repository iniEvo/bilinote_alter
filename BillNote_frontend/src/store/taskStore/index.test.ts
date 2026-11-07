import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskStore, type HistoryItem, type TaskFormData } from '@/store/taskStore'
import { moveTaskToBatch } from '@/services/note.ts'

vi.mock('@/services/note.ts', () => ({
  batchCancel: vi.fn().mockResolvedValue({}),
  batchClearFailed: vi.fn().mockResolvedValue({ count: 0, cleared: [] }),
  batchPause: vi.fn().mockResolvedValue({}),
  batchResume: vi.fn().mockResolvedValue({ resumed: [], count: 0 }),
  batchRetryFailed: vi.fn().mockResolvedValue({ count: 0, retried: [], skipped: [] }),
  delete_task: vi.fn().mockResolvedValue({}),
  detach_batch_tasks: vi.fn().mockResolvedValue({ batch_id: 'b-detach', count: 2 }),
  generateNote: vi.fn().mockResolvedValue({}),
  get_task_status: vi.fn().mockResolvedValue({}),
  getBatchStatus: vi.fn().mockResolvedValue({
    batch_id: 'b',
    batch_name: null,
    control_state: null,
    summary: { total: 0, success: 0, failed: 0, pending: 0, paused: 0, canceled: 0 },
    items: [],
  }),
  getHistory: vi.fn().mockResolvedValue([]),
  getHistoryTask: vi.fn().mockResolvedValue(null),
  renameBatch: vi.fn().mockResolvedValue({}),
  moveTaskToBatch: vi.fn().mockResolvedValue({}),
  getAllBatches: vi.fn().mockResolvedValue([]),
}))

const createFormData = (videoUrl: string): TaskFormData => ({
  video_url: videoUrl,
  link: false,
  screenshot: false,
  platform: 'bilibili',
  quality: 'fast',
  model_name: 'test-model',
  provider_id: 'provider-1',
  format: [],
  style: '',
  extras: '',
  video_understanding: false,
  video_interval: 0,
  grid_size: [],
})

const baseHistoryItem = (taskId: string, overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  task_id: taskId,
  video_id: `video-${taskId}`,
  platform: 'bilibili',
  batch_id: 'batch-1',
  batch_name: 'Batch One',
  source_url: `https://example.com/${taskId}`,
  video_url: `https://example.com/${taskId}`,
  title: `Task ${taskId}`,
  created_at: '2025-01-01T00:00:00.000Z',
  status: 'SUCCESS',
  message: '',
  request_payload: createFormData(`https://example.com/${taskId}`),
  result: {
    markdown: `# ${taskId}`,
    transcript: { full_text: `transcript-${taskId}`, language: 'zh', raw: null, segments: [] },
    audio_meta: {
      title: `Task ${taskId}`,
      cover_url: `https://img.example.com/${taskId}.jpg`,
      platform: 'bilibili',
      video_id: `video-${taskId}`,
    },
  },
  ...overrides,
})

describe('taskStore batch reconciliation', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      batchGroups: [],
      currentTaskId: null,
      keepFormDraft: false,
      focusedBatchId: null,
      historyHasMore: true,
      hasHydrated: true,
      batchItems: {},
    })
  })

  it('upserts remote-only batch items into tasks for preview selection', () => {
    const item = baseHistoryItem('task-remote')

    useTaskStore.getState().reconcileBatchStatus(
      'batch-1',
      [item],
      {
        id: 'batch-1',
        name: 'Batch One',
        createdAt: '2025-01-01T00:00:00.000Z',
        platform: 'bilibili',
        total: 1,
        success: 1,
        failed: 0,
        pending: 0,
        paused: 0,
        canceled: 0,
        taskIds: ['task-remote'],
        controlState: 'RUNNING',
        filter: 'all',
      },
      'RUNNING',
      'Batch One',
    )

    const state = useTaskStore.getState()
    const remoteTask = state.tasks.find(task => task.id === 'task-remote')

    expect(remoteTask).toBeDefined()
    expect(remoteTask?.markdown).toBe('# task-remote')
    expect(remoteTask?.audioMeta.cover_url).toBe('https://img.example.com/task-remote.jpg')

    useTaskStore.getState().setCurrentTask('task-remote')
    expect(useTaskStore.getState().getCurrentTask()?.markdown).toBe('# task-remote')
  })

  it('keeps only searched task ids from remote batch items', () => {
    const matched = baseHistoryItem('task-hit', {
      title: 'Alpha Match',
      result: {
        ...baseHistoryItem('task-hit').result,
        audio_meta: {
          ...baseHistoryItem('task-hit').result?.audio_meta,
          title: 'Alpha Match',
        },
      },
    })
    const hidden = baseHistoryItem('task-miss', {
      title: 'Beta Miss',
      result: {
        ...baseHistoryItem('task-miss').result,
        audio_meta: {
          ...baseHistoryItem('task-miss').result?.audio_meta,
          title: 'Beta Miss',
        },
      },
    })

    useTaskStore.getState().reconcileBatchStatus(
      'batch-1',
      [matched, hidden],
      {
        id: 'batch-1',
        name: 'Batch One',
        createdAt: '2025-01-01T00:00:00.000Z',
        platform: 'bilibili',
        total: 2,
        success: 2,
        failed: 0,
        pending: 0,
        paused: 0,
        canceled: 0,
        taskIds: ['task-hit', 'task-miss'],
        controlState: 'RUNNING',
        filter: 'all',
      },
      'RUNNING',
      'Batch One',
    )

    const groups = useTaskStore.getState().batchGroups
    const searchedGroups = groups
      .map(group => {
        const matchingTaskIds = group.taskIds.filter((taskId) => {
          const task = useTaskStore.getState().tasks.find(entry => entry.id === taskId)
          if (!task)
            return false
          const title = task.audioMeta.title || ''
          const videoUrl = task.formData.video_url || ''
          return `${title} ${videoUrl}`.toLocaleLowerCase().includes('alpha')
        })
        return matchingTaskIds.length > 0 ? { ...group, taskIds: matchingTaskIds } : null
      })
      .filter((group): group is NonNullable<typeof group> => group !== null)

    expect(searchedGroups).toHaveLength(1)
    expect(searchedGroups[0].taskIds).toEqual(['task-hit'])

    const visibleTaskIds = new Set(searchedGroups[0].taskIds)
    const visibleRemoteItems = useTaskStore.getState().getBatchItems('batch-1')
      .filter(item => visibleTaskIds.has(item.task_id))
      .map(item => item.task_id)

    expect(visibleRemoteItems).toEqual(['task-hit'])
  })

  it('marks batch as completed when backend has no control state and no pending tasks', () => {
    const item = baseHistoryItem('task-complete')

    useTaskStore.getState().reconcileBatchStatus(
      'batch-1',
      [item],
      {
        id: 'batch-1',
        name: 'Batch One',
        createdAt: '2025-01-01T00:00:00.000Z',
        platform: 'bilibili',
        total: 1,
        success: 1,
        failed: 0,
        pending: 0,
        paused: 0,
        canceled: 0,
        taskIds: ['task-complete'],
        controlState: null,
        filter: 'all',
      },
      null,
      'Batch One',
    )

    const group = useTaskStore.getState().batchGroups.find(entry => entry.id === 'batch-1')
    expect(group?.controlState).toBe('COMPLETED')
    expect(group?.pending).toBe(0)
  })

  it('detached batch does not leave a ghost group', async () => {
    // Seed store with a batch that has two tasks
    useTaskStore.getState().upsertHistoryTask({ task_id: 't1', platform: 'bilibili', batch_id: 'b-detach', batch_name: 'Detach Me' })
    useTaskStore.getState().upsertHistoryTask({ task_id: 't2', platform: 'bilibili', batch_id: 'b-detach', batch_name: 'Detach Me' })
    expect(useTaskStore.getState().batchGroups.find(g => g.id === 'b-detach')).toBeDefined()

    // Simulate user clicking "移出项目视图"
    await useTaskStore.getState().removeBatchGroup('b-detach')

    // The group must be fully removed — not just emptied
    expect(useTaskStore.getState().batchGroups.find(g => g.id === 'b-detach')).toBeUndefined()
  })

  it('prunes local terminal tasks the server no longer has in the batch', () => {
    // 幽灵任务：离线清理等历史操作在服务端删了行，本地 IndexedDB 仍残留。
    // 它们会一直挂在失败角标上，而清理接口在服务端找不到行、永远提示无任务可清理。
    useTaskStore.getState().upsertHistoryTask({ task_id: 't-live', platform: 'bilibili', batch_id: 'batch-1', batch_name: 'Batch One', status: 'SUCCESS' })
    useTaskStore.getState().upsertHistoryTask({ task_id: 't-ghost-failed', platform: 'bilibili', batch_id: 'batch-1', batch_name: 'Batch One', status: 'FAILED' })
    useTaskStore.getState().upsertHistoryTask({ task_id: 't-ghost-pending', platform: 'bilibili', batch_id: 'batch-1', batch_name: 'Batch One', status: 'PENDING' })

    useTaskStore.getState().reconcileBatchStatus(
      'batch-1',
      [baseHistoryItem('t-live')],
      {
        id: 'batch-1',
        name: 'Batch One',
        createdAt: '2025-01-01T00:00:00.000Z',
        platform: 'bilibili',
        total: 1,
        success: 1,
        failed: 0,
        pending: 0,
        paused: 0,
        canceled: 0,
        taskIds: ['t-live'],
        controlState: 'COMPLETED',
        filter: 'all',
      },
      'COMPLETED',
      'Batch One',
    )

    const ids = useTaskStore.getState().tasks.map(task => task.id)
    expect(ids).toContain('t-live')
    // 终态幽灵任务被剔除
    expect(ids).not.toContain('t-ghost-failed')
    // 进行中不剔除：可能是刚提交、尚未写入服务端的本地乐观任务
    expect(ids).toContain('t-ghost-pending')
  })

  it('manually created empty project is preserved after buildBatchGroups', () => {
    const id = useTaskStore.getState().createEmptyProject('空项目')
    const group = useTaskStore.getState().batchGroups.find(g => g.id === id)
    expect(group).toBeDefined()
    expect(group?.total).toBe(0)
    expect(group?.taskIds).toEqual([])
    expect(group?.isManuallyCreated).toBe(true)

    // After another buildBatchGroups pass (e.g. from refreshHistoryList), it should still exist
    useTaskStore.getState().upsertHistoryTask({ task_id: 'unrelated', platform: 'bilibili' })
    expect(useTaskStore.getState().batchGroups.find(g => g.id === id)).toBeDefined()
  })
})

describe('taskStore project note ordering', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      batchGroups: [],
      currentTaskId: null,
      keepFormDraft: false,
      focusedBatchId: null,
      historyHasMore: true,
      hasHydrated: true,
      batchItems: {},
    })
  })

  it('returns batch items newest first even when stored ascending', () => {
    // 模拟持久化的旧顺序（升序）/ 尚未重启的旧后端返回
    useTaskStore.setState({
      batchItems: {
        'batch-1': [
          baseHistoryItem('task-old', { created_at: '2025-01-01T00:00:00.000Z' }),
          baseHistoryItem('task-mid', { created_at: '2025-01-02T00:00:00.000Z' }),
          baseHistoryItem('task-new', { created_at: '2025-01-03T00:00:00.000Z' }),
        ],
      },
    })

    const ordered = useTaskStore.getState().getBatchItems('batch-1').map(item => item.task_id)

    expect(ordered).toEqual(['task-new', 'task-mid', 'task-old'])
  })

  it('does not mutate the stored batch items array', () => {
    const stored = [
      baseHistoryItem('task-old', { created_at: '2025-01-01T00:00:00.000Z' }),
      baseHistoryItem('task-new', { created_at: '2025-01-03T00:00:00.000Z' }),
    ]
    useTaskStore.setState({ batchItems: { 'batch-1': stored } })

    useTaskStore.getState().getBatchItems('batch-1')

    expect(useTaskStore.getState().batchItems['batch-1'].map(item => item.task_id))
      .toEqual(['task-old', 'task-new'])
  })

  it('returns an empty list for unknown batches', () => {
    expect(useTaskStore.getState().getBatchItems('missing')).toEqual([])
  })
})

describe('taskStore moveTaskToProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskStore.setState({
      tasks: [],
      batchGroups: [],
      currentTaskId: null,
      keepFormDraft: false,
      focusedBatchId: null,
      historyHasMore: true,
      hasHydrated: true,
      batchItems: {},
    })
  })

  it('detaches a task from its project when batch values are empty', async () => {
    const item = baseHistoryItem('task-1', { batch_id: 'batch-1', batch_name: 'Batch One' })
    useTaskStore.getState().upsertHistoryTask(item)
    useTaskStore.setState({
      batchItems: { 'batch-1': [item] },
      batchGroups: [{
        id: 'batch-1',
        name: 'Batch One',
        createdAt: '2025-01-01T00:00:00.000Z',
        platform: 'bilibili',
        total: 1,
        success: 1,
        failed: 0,
        pending: 0,
        paused: 0,
        canceled: 0,
        taskIds: ['task-1'],
        filter: 'all',
      }],
    })

    const ok = await useTaskStore.getState().moveTaskToProject('task-1', '', '')

    expect(ok).toBe(true)
    expect(moveTaskToBatch).toHaveBeenCalledWith('task-1', '', '')
    const state = useTaskStore.getState()
    // 空字符串必须落成 undefined：留着 batchId: '' 会让卡片继续认为自己属于项目
    expect(state.tasks[0].batchId).toBeUndefined()
    expect(state.tasks[0].batchName).toBeUndefined()
    expect(state.batchGroups.find(g => g.id === 'batch-1')).toBeUndefined()
    // 残留的 batchItems 会让该项目面板继续渲染这条任务
    expect(state.getBatchItems('batch-1')).toEqual([])
  })

  it('moves a task into a project and keeps other projects untouched', async () => {
    const item = baseHistoryItem('task-1', { batch_id: undefined, batch_name: undefined })
    const other = baseHistoryItem('task-2', { batch_id: 'batch-2', batch_name: 'Batch Two' })
    useTaskStore.getState().upsertHistoryTask(item)
    useTaskStore.getState().upsertHistoryTask(other)
    useTaskStore.setState({ batchItems: { 'batch-2': [other] } })

    const ok = await useTaskStore.getState().moveTaskToProject('task-1', 'batch-9', 'Batch Nine')

    expect(ok).toBe(true)
    const state = useTaskStore.getState()
    expect(state.tasks.find(t => t.id === 'task-1')?.batchId).toBe('batch-9')
    expect(state.tasks.find(t => t.id === 'task-1')?.batchName).toBe('Batch Nine')
    expect(state.batchGroups.find(g => g.id === 'batch-9')?.name).toBe('Batch Nine')
    // 移入别的项目不应影响其它项目的远程条目
    expect(state.getBatchItems('batch-2').map(i => i.task_id)).toEqual(['task-2'])
  })

  it('reports failure and leaves state alone when the request rejects', async () => {
    const item = baseHistoryItem('task-1', { batch_id: 'batch-1', batch_name: 'Batch One' })
    useTaskStore.getState().upsertHistoryTask(item)
    vi.mocked(moveTaskToBatch).mockRejectedValueOnce({ code: 400, msg: 'boom' })

    const ok = await useTaskStore.getState().moveTaskToProject('task-1', '', '')

    expect(ok).toBe(false)
    expect(useTaskStore.getState().tasks[0].batchId).toBe('batch-1')
  })
})
