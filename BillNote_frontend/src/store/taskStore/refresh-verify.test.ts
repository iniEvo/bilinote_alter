import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskStore, createHistoryTask, type HistoryItem } from '@/store/taskStore'
import { getHistory, getHistoryTask, getBatchStatus } from '@/services/note.ts'

vi.mock('@/services/note.ts', () => ({
  batchCancel: vi.fn().mockResolvedValue({}),
  batchClearFailed: vi.fn().mockResolvedValue({ count: 0, cleared: [] }),
  batchPause: vi.fn().mockResolvedValue({}),
  batchResume: vi.fn().mockResolvedValue({ resumed: [], count: 0 }),
  batchRetryFailed: vi.fn().mockResolvedValue({ count: 0, retried: [], skipped: [] }),
  delete_task: vi.fn().mockResolvedValue({}),
  detach_batch_tasks: vi.fn().mockResolvedValue({}),
  generateNote: vi.fn().mockResolvedValue({}),
  get_task_status: vi.fn().mockResolvedValue({}),
  getBatchStatus: vi.fn(),
  getHistory: vi.fn(),
  getHistoryTask: vi.fn(),
  renameBatch: vi.fn().mockResolvedValue({}),
  moveTaskToBatch: vi.fn().mockResolvedValue({}),
  getAllBatches: vi.fn().mockResolvedValue([]),
}))

const formData = (url: string) => ({
  video_url: url,
  link: false,
  screenshot: false,
  platform: 'bilibili',
  quality: 'fast',
  model_name: 'm1',
  provider_id: 'p1',
  style: 'minimal',
  format: [] as string[],
})

const fullItem = (id: string, overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  task_id: id,
  video_id: `v-${id}`,
  platform: 'bilibili',
  source_url: `https://b23.tv/${id}`,
  title: `标题-${id}`,
  created_at: '2026-11-05T10:00:00.000Z',
  status: 'SUCCESS',
  message: '',
  request_payload: formData(`https://b23.tv/${id}`),
  result: {
    markdown: `# 笔记-${id}`,
    transcript: { full_text: 'tx', language: 'zh', raw: null, segments: [] },
    audio_meta: { title: `标题-${id}`, cover_url: 'c', platform: 'bilibili', video_id: `v-${id}` },
  },
  ...overrides,
})

const lightItem = (id: string, overrides: Partial<HistoryItem> = {}): HistoryItem => {
  const item = fullItem(id, overrides)
  return { ...item, result: undefined }
}

const mockBatchGroup = (id: string, name: string, taskIds: string[]) => ({
  id,
  name,
  createdAt: '2026-11-05T10:00:00.000Z',
  platform: 'bilibili',
  total: taskIds.length,
  success: taskIds.length,
  failed: 0,
  pending: 0,
  paused: 0,
  canceled: 0,
  controlState: 'COMPLETED',
  taskIds,
})

beforeEach(() => {
  vi.clearAllMocks()
  useTaskStore.setState({
    tasks: [],
    batchGroups: [],
    currentTaskId: null,
    loadingTaskId: null,
    _loadedContentIds: new Set<string>(),
    keepFormDraft: false,
    focusedBatchId: null,
    historyHasMore: true,
    hasHydrated: true,
    batchItems: {},
  })
})

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('回归 1：hydrateHistory 不能用 light 空数据覆盖已缓存正文，自动选中时应触发内容加载', () => {
  it('持久化的 markdown 在 light 合并后保留', async () => {
    vi.mocked(getHistory).mockImplementation(async (params?: { batch_id?: string }) => {
      if (params?.batch_id === '__none__')
        return []
      return [lightItem('t1')]
    })
    vi.mocked(getBatchStatus).mockResolvedValue({
      batch_id: 'b',
      batch_name: null,
      control_state: null,
      summary: { total: 0, success: 0, failed: 0, pending: 0, paused: 0, canceled: 0 },
      items: [],
    })

    // IndexedDB 里已持久化的完整任务（用户上次已加载过正文）
    const persisted = createHistoryTask(fullItem('t1'))
    expect(persisted.markdown).toBe('# 笔记-t1')

    useTaskStore.setState({
      tasks: [persisted],
      currentTaskId: null,
      hasHydrated: false,
      keepFormDraft: false,
    })

    await useTaskStore.getState().hydrateHistory()

    const task = useTaskStore.getState().tasks.find(t => t.id === 't1')
    // 自动选中最新笔记
    expect(useTaskStore.getState().currentTaskId).toBe('t1')
    // light 合并不得覆盖缓存正文（修复前被洗成 ''，预览区显示「输入视频链接…」空占位）
    expect(task?.markdown).toBe('# 笔记-t1')
    // 正文已在内存 → 不发加载请求
    expect(useTaskStore.getState().loadingTaskId).toBeNull()
  })

  it('缓存正文缺失时，自动选中的笔记立即进入 loading 并发起内容拉取', async () => {
    vi.mocked(getHistory).mockImplementation(async (params?: { batch_id?: string }) => {
      if (params?.batch_id === '__none__')
        return []
      return [lightItem('t1')]
    })
    // 正文拉取挂起，模拟加载中
    vi.mocked(getHistoryTask).mockImplementation(() => new Promise<HistoryItem>(() => {}))

    const emptyPersisted = createHistoryTask(lightItem('t1'))
    useTaskStore.setState({
      tasks: [emptyPersisted],
      currentTaskId: null,
      hasHydrated: false,
      keepFormDraft: false,
    })

    await useTaskStore.getState().hydrateHistory()

    expect(useTaskStore.getState().currentTaskId).toBe('t1')
    // 修复前：hydrate 直接设 currentTaskId，不走 setCurrentTask，预览区无 loading 停在空占位
    expect(useTaskStore.getState().loadingTaskId).toBe('t1')
    expect(vi.mocked(getHistoryTask)).toHaveBeenCalledWith('t1', { suppressToast: true })
  })
})

describe('回归 2：快速连续点击两条未加载笔记，旧请求收尾不得清掉新选中笔记的 loading', () => {
  it('loadingTaskId 在旧请求结束时保持为后选中的笔记', async () => {
    const tasks = [createHistoryTask(lightItem('A')), createHistoryTask(lightItem('B'))]
    useTaskStore.setState({ tasks, hasHydrated: true })

    let resolveA!: (v: HistoryItem) => void
    let resolveB!: (v: HistoryItem) => void
    vi.mocked(getHistoryTask).mockImplementation((id: string) => {
      if (id === 'A')
        return new Promise<HistoryItem>((r) => { resolveA = r })
      return new Promise<HistoryItem>((r) => { resolveB = r })
    })

    useTaskStore.getState().setCurrentTask('A')
    expect(useTaskStore.getState().loadingTaskId).toBe('A')
    await flush()

    useTaskStore.getState().setCurrentTask('B')
    expect(useTaskStore.getState().loadingTaskId).toBe('B')
    await flush()

    // A 的请求后结束，B 仍在加载（resolveB 尚未调用）
    resolveA(fullItem('A'))
    await flush()
    await flush()

    // 修复前此处被 A 的 finally 无条件清成 null，预览区闪现「输入视频链接…」占位
    expect(useTaskStore.getState().loadingTaskId).toBe('B')

    resolveB(fullItem('B'))
    await flush()
    await flush()
    // B 自己的请求结束后才清除
    expect(useTaskStore.getState().loadingTaskId).toBeNull()
    expect(useTaskStore.getState().tasks.find(t => t.id === 'B')?.markdown).toBe('# 笔记-B')
  })
})

describe('回归 3：轮询数据无变化时保持当前任务引用稳定（NoteForm 不再每 3s 被迫 form.reset）', () => {
  it('相同 light 数据连续两次 refresh 后引用不变；状态真实变化时引用才更新', async () => {
    const task = createHistoryTask(lightItem('t1', { batch_id: 'b1', batch_name: '项目一' }))
    useTaskStore.setState({
      tasks: [task],
      currentTaskId: 't1',
      batchGroups: [mockBatchGroup('b1', '项目一', ['t1'])],
      batchItems: { b1: [lightItem('t1', { batch_id: 'b1' })] },
      hasHydrated: true,
    })

    vi.mocked(getHistory).mockResolvedValue([lightItem('t1', { batch_id: 'b1' })])
    vi.mocked(getBatchStatus).mockResolvedValue({
      batch_id: 'b1',
      batch_name: '项目一',
      control_state: 'COMPLETED',
      summary: { total: 1, success: 1, failed: 0, pending: 0, paused: 0, canceled: 0 },
      items: [lightItem('t1', { batch_id: 'b1' })],
    })

    const refBefore = useTaskStore.getState().tasks.find(t => t.id === 't1')
    await useTaskStore.getState().refreshHistoryList()
    const refAfter1 = useTaskStore.getState().tasks.find(t => t.id === 't1')
    await useTaskStore.getState().refreshHistoryList()
    const refAfter2 = useTaskStore.getState().tasks.find(t => t.id === 't1')

    // 数据完全没变：引用必须保持稳定（修复前每 3s 都是新对象，
    // 触发 NoteForm reset effect，把用户正在编辑的备注/格式/风格打回初始值）
    expect(refAfter1).toBe(refBefore)
    expect(refAfter2).toBe(refBefore)

    // 服务端状态真实变化（message 变化）时，引用正常更新以驱动 UI 刷新
    const changed = lightItem('t1', { batch_id: 'b1', message: '排队中' })
    vi.mocked(getHistory).mockResolvedValue([changed])
    vi.mocked(getBatchStatus).mockResolvedValue({
      batch_id: 'b1',
      batch_name: '项目一',
      control_state: 'COMPLETED',
      summary: { total: 1, success: 1, failed: 0, pending: 0, paused: 0, canceled: 0 },
      items: [changed],
    })
    await useTaskStore.getState().refreshHistoryList()
    const refAfterChange = useTaskStore.getState().tasks.find(t => t.id === 't1')
    expect(refAfterChange).not.toBe(refBefore)
    expect(refAfterChange?.message).toBe('排队中')
  })
})

describe('回归 4：选中的批次任务不做幽灵剔除，服务端空清单不打断预览选中', () => {
  it('batch_status 返回空 items 时 currentTaskId 与任务均保留', async () => {
    const task = createHistoryTask(lightItem('t1', { batch_id: 'b1', batch_name: '项目一', status: 'FAILED' }))
    useTaskStore.setState({
      tasks: [task],
      currentTaskId: 't1',
      batchGroups: [mockBatchGroup('b1', '项目一', ['t1'])],
      hasHydrated: true,
    })

    vi.mocked(getHistory).mockResolvedValue([lightItem('t1', { batch_id: 'b1', status: 'FAILED' })])
    // 后端对已不存在的批次返回 success + 空 items（也可能是瞬时异常）
    vi.mocked(getBatchStatus).mockResolvedValue({
      batch_id: 'b1',
      batch_name: '项目一',
      control_state: null,
      summary: { total: 0, success: 0, failed: 0, pending: 0, paused: 0, canceled: 0 },
      items: [],
    })

    await useTaskStore.getState().refreshHistoryList()

    // 修复前：当前任务被幽灵剔除，选中被静默清空、预览跳回空态
    expect(useTaskStore.getState().currentTaskId).toBe('t1')
    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')).toBeDefined()
  })

  it('非选中任务的幽灵剔除逻辑保持不变', async () => {
    const selected = createHistoryTask(lightItem('sel', { batch_id: 'b1', status: 'FAILED' }))
    const ghost = createHistoryTask(lightItem('ghost', { batch_id: 'b1', status: 'FAILED' }))
    useTaskStore.setState({
      tasks: [selected, ghost],
      currentTaskId: 'sel',
      batchGroups: [mockBatchGroup('b1', '项目一', ['sel', 'ghost'])],
      hasHydrated: true,
    })

    vi.mocked(getHistory).mockResolvedValue([
      lightItem('sel', { batch_id: 'b1', status: 'FAILED' }),
      lightItem('ghost', { batch_id: 'b1', status: 'FAILED' }),
    ])
    vi.mocked(getBatchStatus).mockResolvedValue({
      batch_id: 'b1',
      batch_name: '项目一',
      control_state: 'COMPLETED',
      summary: { total: 1, success: 1, failed: 0, pending: 0, paused: 0, canceled: 0 },
      // 服务端已没有 ghost 这条
      items: [lightItem('sel', { batch_id: 'b1', status: 'FAILED' })],
    })

    await useTaskStore.getState().refreshHistoryList()

    expect(useTaskStore.getState().currentTaskId).toBe('sel')
    expect(useTaskStore.getState().tasks.find(t => t.id === 'sel')).toBeDefined()
    expect(useTaskStore.getState().tasks.find(t => t.id === 'ghost')).toBeUndefined()
  })
})
