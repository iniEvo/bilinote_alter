import { create } from 'zustand'
import toast from 'react-hot-toast'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  batchCancel,
  batchClearFailed,
  batchPause,
  batchResume,
  batchRetryFailed,
  delete_task,
  detach_batch_tasks,
  generateNote,
  get_task_status,
  getBatchStatus,
  getHistory,
  getHistoryTask,
  renameBatch,
  moveTaskToBatch,
  getAllBatches,
} from '@/services/note.ts'
import { v4 as uuidv4 } from 'uuid'
import { del, get, set } from 'idb-keyval'

export const HISTORY_PAGE_SIZE = 20

/** 批次重试/续跑时的模型覆盖：同时提供 provider 与 model，缺省则沿用任务原配置 */
export interface ModelOverride {
  provider_id: string
  model_name: string
}

export type TaskStatus =
  | 'PENDING'
  | 'PAUSED'
  | 'CANCELED'
  | 'PARSING'
  | 'DOWNLOADING'
  | 'TRANSCRIBING'
  | 'SUMMARIZING'
  | 'FORMATTING'
  | 'SAVING'
  | 'SUCCESS'
  | 'FAILED'
  | 'RETRYABLE'

export interface AudioMeta {
  cover_url: string
  duration: number
  file_path: string
  platform: string
  raw_info: unknown
  title: string
  video_id: string
}

export interface Segment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  full_text: string
  language: string
  raw: unknown
  segments: Segment[]
}

export interface Markdown {
  ver_id: string
  content: string
  style: string
  model_name: string
  created_at: string
}

export interface TaskFormData {
  video_url: string
  link: undefined | boolean
  screenshot: undefined | boolean
  platform: string
  quality: string
  model_name: string
  provider_id: string
  style?: string
  format?: string[]
  extras?: string
  video_understanding?: boolean
  video_interval?: number
  grid_size?: number[]
}

export interface Task {
  id: string
  markdown: string | Markdown[]
  transcript: Transcript
  status: TaskStatus
  audioMeta: AudioMeta
  platform?: string
  createdAt: string
  batchId?: string
  batchName?: string
  sourceUrl?: string
  message?: string
  formData: TaskFormData
}

export type BatchControlState = 'RUNNING' | 'PAUSED' | 'CANCELED' | 'COMPLETED'

export interface BatchTaskGroup {
  id: string
  name: string
  createdAt: string
  platform: string
  total: number
  success: number
  failed: number
  pending: number
  paused: number
  canceled: number
  controlState?: BatchControlState | null
  taskIds: string[]
  filter?: 'all' | 'success' | 'failed'
  /** 仅手动新建的空项目为 true；用于在 buildBatchGroups 时与"已移出的幽灵项目"区分 */
  isManuallyCreated?: boolean
}

interface TaskStore {
  tasks: Task[]
  batchGroups: BatchTaskGroup[]
  currentTaskId: string | null
  loadingTaskId: string | null
  _loadedContentIds: Set<string>
  keepFormDraft: boolean
  focusedBatchId: string | null
  historyHasMore: boolean
  hasHydrated: boolean
  _unloadedBatchIds?: string[]
  batchItems: Record<string, HistoryItem[]>
  addPendingTask: (taskId: string, platform: string, formData: TaskFormData, batchId?: string, sourceUrl?: string, batchName?: string) => void
  addBatchGroup: (batchId: string, platform: string, taskIds: string[], batchName?: string) => void
  createEmptyProject: (name: string) => string
  upsertHistoryTask: (item: HistoryItem) => Task
  getBatchItems: (batchId: string) => HistoryItem[]
  setBatchFilter: (batchId: string, filter: 'all' | 'success' | 'failed') => void
  reconcileBatchStatus: (
    batchId: string,
    items: HistoryItem[],
    summary: BatchTaskGroup,
    controlState?: BatchControlState | null,
    batchName?: string,
  ) => void
  updateBatchProgress: (batchId: string, progress: Partial<BatchTaskGroup>) => void
  updateTaskContent: (id: string, data: Partial<Omit<Task, 'id' | 'createdAt'>>) => void
  removeTask: (id: string) => Promise<void>
  removeBatchGroup: (batchId: string) => Promise<void>
  pauseBatchGroup: (batchId: string) => Promise<void>
  resumeBatchGroup: (batchId: string, override?: ModelOverride) => Promise<void>
  cancelBatchGroup: (batchId: string) => Promise<void>
  clearFailedBatchTasks: (batchId: string) => Promise<void>
  retryFailedBatchTasks: (batchId: string, override?: ModelOverride) => Promise<void>
  clearTasks: () => void
  setHasHydrated: (hydrated: boolean) => void
  setCurrentTask: (taskId: string | null) => void
  setKeepFormDraft: (keep: boolean) => void
  setFocusedBatch: (batchId: string | null) => void
  getCurrentTask: () => Task | null
  retryTask: (id: string, payload?: TaskFormData) => Promise<void>
  hydrateHistory: () => Promise<void>
  refreshHistoryList: () => Promise<void>
  loadMoreHistory: () => Promise<void>
  renameBatch: (batchId: string, newName: string) => Promise<boolean>
  moveTaskToProject: (taskId: string, batchId: string, batchName: string) => Promise<boolean>
  fetchAllBatches: () => Promise<Array<{ batch_id: string, batch_name: string }>>
}

export interface HistoryItem {
  task_id: string
  video_id?: string
  platform: string
  batch_id?: string
  batch_name?: string
  source_url?: string
  video_url?: string
  title?: string
  created_at?: string
  status?: string
  message?: string
  request_payload?: Partial<TaskFormData>
  result?: {
    markdown?: string
    transcript?: Transcript
    audio_meta?: Partial<AudioMeta>
  }
}

const isTaskStatus = (value: string | undefined): value is TaskStatus => Boolean(value && [
  'PENDING',
  'PAUSED',
  'CANCELED',
  'PARSING',
  'DOWNLOADING',
  'TRANSCRIBING',
  'SUMMARIZING',
  'FORMATTING',
  'SAVING',
  'SUCCESS',
  'FAILED',
  'RETRYABLE',
].includes(value))

const parseTaskStatus = (value: string | undefined, fallback: TaskStatus = 'PENDING'): TaskStatus => {
  const normalized = value?.toUpperCase()
  return isTaskStatus(normalized) ? normalized : fallback
}

const hasFullHistoryResult = (item: HistoryItem) => {
  const result = item.result
  return Boolean(result && (result.markdown || result.transcript || result.audio_meta))
}

const createFallbackAudioMeta = (item: HistoryItem): AudioMeta => ({
  cover_url: '',
  duration: 0,
  file_path: '',
  platform: item.platform,
  raw_info: { id: item.video_id },
  title: item.title || item.video_id || item.source_url || item.video_url || '',
  video_id: item.video_id || '',
})

const createFormData = (item: HistoryItem): TaskFormData => ({
  video_url: item.request_payload?.video_url || item.source_url || item.video_url || '',
  link: item.request_payload?.link ?? false,
  screenshot: item.request_payload?.screenshot ?? false,
  platform: item.request_payload?.platform || item.platform,
  quality: item.request_payload?.quality || 'fast',
  model_name: item.request_payload?.model_name || '',
  provider_id: item.request_payload?.provider_id || '',
  style: item.request_payload?.style,
  format: item.request_payload?.format,
  extras: item.request_payload?.extras,
  video_understanding: item.request_payload?.video_understanding,
  video_interval: item.request_payload?.video_interval,
  grid_size: item.request_payload?.grid_size,
})

const toCreatedAtMs = (value?: string) => {
  if (!value)
    return 0
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : 0
}

/** 项目内笔记列表统一按创建时间从近到远。持久化的旧顺序或未重启的旧后端
 * 都可能给出升序数据，读取时归一化保证展示顺序不受来源影响。 */
const byCreatedAtDesc = (a: HistoryItem, b: HistoryItem) =>
  toCreatedAtMs(b.created_at) - toCreatedAtMs(a.created_at)

/** 任务卡片（Task）版本的同一比较器：batchItems 未就绪时列表会退回
 * group.taskIds（提交顺序），同样需要归一化成从近到远。 */
export const sortTasksByCreatedAtDesc = <T extends { createdAt?: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => toCreatedAtMs(b.createdAt) - toCreatedAtMs(a.createdAt))

export const createHistoryTask = (item: HistoryItem): Task => {
  const result = item.result || {}
  return {
    id: item.task_id,
    status: parseTaskStatus(item.status, result ? 'SUCCESS' : 'PENDING'),
    markdown: result.markdown || '',
    transcript: result.transcript || { full_text: '', language: '', raw: null, segments: [] },
    audioMeta: result.audio_meta
      ? { ...createFallbackAudioMeta(item), ...result.audio_meta }
      : createFallbackAudioMeta(item),
    platform: item.platform,
    batchId: item.batch_id,
    batchName: item.batch_name,
    sourceUrl: item.source_url || item.video_url || '',
    message: item.message,
    formData: createFormData(item),
    createdAt: item.created_at || new Date().toISOString(),
  }
}

const patchHistoryCardTask = (existing: Task, item: HistoryItem): Task => {
  if (hasFullHistoryResult(item)) {
    const restored = createHistoryTask(item)
    const next: Task = {
      ...existing,
      ...restored,
      formData: restored.formData,
    }
    return taskSnapshotEquals(existing, next) ? existing : next
  }

  const incomingAudioMeta = item.result?.audio_meta || {}
  const next: Task = {
    ...existing,
    status: parseTaskStatus(item.status, existing.status),
    createdAt: item.created_at || existing.createdAt,
    platform: item.platform || existing.platform,
    batchId: item.batch_id || existing.batchId,
    batchName: item.batch_name || existing.batchName,
    sourceUrl: item.source_url || item.video_url || existing.sourceUrl,
    message: item.message || existing.message,
    formData: {
      ...existing.formData,
      ...createFormData(item),
    },
    audioMeta: {
      ...existing.audioMeta,
      cover_url: incomingAudioMeta.cover_url || existing.audioMeta?.cover_url || '',
      title: incomingAudioMeta.title || existing.audioMeta?.title || item.video_id || item.source_url || item.video_url || '',
      platform: incomingAudioMeta.platform || existing.audioMeta?.platform || item.platform || '',
      video_id: incomingAudioMeta.video_id || existing.audioMeta?.video_id || item.video_id || '',
    },
  }
  // 轮询每 3s 都会走这里：数据无变化时返回原对象，保持引用稳定。
  // 否则 currentTask 引用每 3s 变一次，NoteForm 的 reset effect / 各订阅组件被反复触发。
  return taskSnapshotEquals(existing, next) ? existing : next
}

/** 比较两份 Task 的全部业务字段（markdown/transcript 走 JSON 比较覆盖结构化内容） */
const taskSnapshotEquals = (a: Task, b: Task): boolean =>
  a.status === b.status
  && a.createdAt === b.createdAt
  && a.platform === b.platform
  && a.batchId === b.batchId
  && a.batchName === b.batchName
  && a.sourceUrl === b.sourceUrl
  && a.message === b.message
  && JSON.stringify([a.formData, a.audioMeta, a.markdown, a.transcript])
    === JSON.stringify([b.formData, b.audioMeta, b.markdown, b.transcript])

const getRetrySkipReasonLabel = (reason?: string, fallbackStatus?: string) => {
  if (!reason) {
    if (fallbackStatus && fallbackStatus !== 'FAILED' && fallbackStatus !== 'RETRYABLE')
      return `任务当前状态为 ${fallbackStatus}，只有失败/可重试任务才能重试`
    return '当前任务不可重试'
  }

  if (reason.startsWith('missing_fields:')) {
    const fields = reason.slice('missing_fields:'.length)
    return `任务缺少重试参数：${fields}`
  }
  if (reason === 'missing_video_url')
    return '任务缺少视频地址，无法重试'
  if (reason.startsWith('invalid_payload:'))
    return '任务重试参数无效，请重新生成后再试'
  if (reason === 'task_not_failed')
    return `任务当前状态为 ${fallbackStatus || '非失败'}，只有失败任务才能重试`
  if (reason.startsWith('provider_disabled'))
    return `原模型供应商「${reason.slice('provider_disabled:'.length)}」已关闭，请在批次「重试失败项」中选择新模型后重试`
  return reason
}

const buildBatchGroups = (tasks: Task[], previousGroups: BatchTaskGroup[] = []): BatchTaskGroup[] => {
  if (!Array.isArray(previousGroups)) previousGroups = []
  const groups = new Map<string, BatchTaskGroup>()
  const previousMap = new Map(previousGroups.map(group => [group.id, group]))
  for (const task of tasks) {
    if (!task.batchId)
      continue
    const previous = previousMap.get(task.batchId)
    const existing = groups.get(task.batchId) || {
      id: task.batchId,
      name: task.batchName || previous?.name || task.batchId,
      createdAt: task.createdAt,
      platform: task.platform || task.formData.platform,
      total: 0,
      success: 0,
      failed: 0,
      pending: 0,
      paused: 0,
      canceled: 0,
      controlState: previous?.controlState,
      taskIds: previous?.taskIds ? [...previous.taskIds] : [],
      filter: previous?.filter || 'all',
    }
    if (!existing.taskIds.includes(task.id))
      existing.taskIds.push(task.id)
    existing.name = task.batchName || previous?.name || existing.name
    if (new Date(task.createdAt).getTime() > new Date(existing.createdAt).getTime())
      existing.createdAt = task.createdAt
    groups.set(task.batchId, existing)
  }
  // Recompute counts from actual tasks
  const taskMap = new Map(tasks.map(t => [t.id, t]))
  for (const group of groups.values()) {
    let total = 0, success = 0, failed = 0, pending = 0, paused = 0, canceled = 0
    for (const taskId of group.taskIds) {
      const task = taskMap.get(taskId)
      if (!task) continue
      total++
      switch (task.status) {
        case 'SUCCESS': success++; break
        case 'FAILED': case 'RETRYABLE': failed++; break
        case 'PENDING': case 'PARSING': case 'DOWNLOADING': case 'TRANSCRIBING':
        case 'SUMMARIZING': case 'FORMATTING': case 'SAVING': pending++; break
        case 'PAUSED': paused++; break
        case 'CANCELED': canceled++; break
      }
    }
    group.total = total
    group.success = success
    group.failed = failed
    group.pending = pending
    group.paused = paused
    group.canceled = canceled
  }
  // 只保留上一轮「手动新建」的、没有任何任务引用的空项目组（isManuallyCreated）。
  // 不能无条件保留所有空组：被「移出项目视图」(removeBatchGroup/detach) 的批次在后端
  // 已经没有任务，若不区分，detach 后它会被以空组形式重新加回 batchGroups，导致
  // 角标数量虚高、幽灵项目永不消失（backend /batch_status 对不存在批次返回成功+空列表）。
  for (const prev of previousGroups) {
    if (!prev.isManuallyCreated)
      continue
    if (!groups.has(prev.id)) {
      groups.set(prev.id, {
        ...prev,
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
        paused: 0,
        canceled: 0,
        taskIds: [],
      })
    }
  }
  return [...groups.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

const resolveBatchControlState = (
  controlState: BatchControlState | null | undefined,
  summary: Pick<BatchTaskGroup, 'pending'>,
): BatchControlState => {
  if (controlState)
    return controlState
  return summary.pending > 0 ? 'RUNNING' : 'COMPLETED'
}

// /batch_status 返回的是该批次在服务端的全量任务清单。本地残留、但服务端已不存在的
// 终态任务（离线清理重复行等历史操作遗留的“幽灵任务”）必须剔除：否则它们会一直
// 挂在失败角标/失败列表里，而「一键清理失败任务」在服务端找不到对应行，
// 点了只会提示「当前没有可清理的失败任务」。
// 仅剔除终态：PENDING/进行中的任务可能是刚提交、尚未写入服务端的本地乐观任务。
const PRUNABLE_BATCH_STATUSES = new Set<TaskStatus>(['SUCCESS', 'FAILED', 'CANCELED', 'RETRYABLE'])

const findGhostBatchTaskIds = (
  tasks: Iterable<{ id: string, batchId?: string, status: TaskStatus }>,
  batchId: string,
  serverTaskIds: Set<string>,
): Set<string> => {
  const ghostIds = new Set<string>()
  for (const task of tasks) {
    if (task.batchId === batchId && !serverTaskIds.has(task.id) && PRUNABLE_BATCH_STATUSES.has(task.status))
      ghostIds.add(task.id)
  }
  return ghostIds
}

const memoryStorage = new Map<string, string>()

const taskStoreStorage = createJSONStorage(() => {
  const hasIndexedDB = typeof globalThis !== 'undefined' && 'indexedDB' in globalThis
  if (!hasIndexedDB) {
    return {
      getItem: async (name: string): Promise<string | null> => memoryStorage.get(name) ?? null,
      setItem: async (name: string, value: string): Promise<void> => {
        memoryStorage.set(name, value)
      },
      removeItem: async (name: string): Promise<void> => {
        memoryStorage.delete(name)
      },
    }
  }

  return {
    getItem: async (name: string): Promise<string | null> => {
      const value = await get(name)
      return value ?? null
    },
    setItem: async (name: string, value: string): Promise<void> => {
      await set(name, value)
    },
    removeItem: async (name: string): Promise<void> => {
      await del(name)
    },
  }
})

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      batchGroups: [],
      currentTaskId: null,
      loadingTaskId: null,
      _loadedContentIds: new Set<string>(),
      keepFormDraft: false,
      focusedBatchId: null,
      historyHasMore: true,
      hasHydrated: false,
      batchItems: {},

      addPendingTask: (taskId, platform, formData, batchId, sourceUrl, batchName) =>
        set(state => {
          const tasks = [
            {
              formData,
              id: taskId,
              status: 'PENDING' as TaskStatus,
              markdown: '',
              platform,
              batchId,
              batchName,
              sourceUrl: sourceUrl || formData.video_url,
              message: '',
              transcript: {
                full_text: '',
                language: '',
                raw: null,
                segments: [],
              },
              createdAt: new Date().toISOString(),
              audioMeta: {
                cover_url: '',
                duration: 0,
                file_path: '',
                platform: '',
                raw_info: null,
                title: '',
                video_id: '',
              },
            },
            ...state.tasks,
          ]
          return {
            tasks,
            batchGroups: buildBatchGroups(tasks, state.batchGroups),
            currentTaskId: taskId,
            keepFormDraft: false,
          }
        }),

      addBatchGroup: (batchId, platform, taskIds, batchName) =>
        set(state => ({
          batchGroups: [
            {
              id: batchId,
              name: batchName || batchId,
              createdAt: new Date().toISOString(),
              platform,
              total: taskIds.length,
              success: 0,
              failed: 0,
              pending: taskIds.length,
              paused: 0,
              canceled: 0,
              controlState: 'RUNNING',
              taskIds,
              filter: 'all',
            },
            ...state.batchGroups.filter(group => group.id !== batchId),
          ],
        })),

      createEmptyProject: (name: string) => {
        const batchId = crypto.randomUUID()
        const trimmed = name.trim() || batchId
        set(state => ({
          batchGroups: [
            {
              id: batchId,
              name: trimmed,
              createdAt: new Date().toISOString(),
              platform: '',
              total: 0,
              success: 0,
              failed: 0,
              pending: 0,
              paused: 0,
              canceled: 0,
              controlState: 'COMPLETED',
              taskIds: [],
              filter: 'all',
              isManuallyCreated: true,
            },
            ...state.batchGroups.filter(group => group.id !== batchId),
          ],
        }))
        return batchId
      },

      // 项目内笔记列表按创建时间从近到远：持久化的旧顺序、以及尚未重启的旧后端
      // 都可能给出升序数据，故在读取这一处统一归一化，两个面板都走这个入口。
      getBatchItems: batchId => [...(get().batchItems[batchId] || [])].sort(byCreatedAtDesc),

      setBatchFilter: (batchId, filter) => set(state => ({
        batchGroups: state.batchGroups.map(group =>
          group.id === batchId ? { ...group, filter } : group,
        ),
      })),

      reconcileBatchStatus: (batchId, items, summary, controlState, batchName) =>
        set(state => {
          const existingMap = new Map(state.tasks.map(task => [task.id, task]))
          const mergedBatchTasks = items.map((item) => {
            const existing = existingMap.get(item.task_id)
            return existing ? patchHistoryCardTask(existing, item) : createHistoryTask(item)
          })
          const mergedBatchMap = new Map(mergedBatchTasks.map(task => [task.id, task]))
          const ghostIds = findGhostBatchTaskIds(state.tasks, batchId, new Set(items.map(item => item.task_id)))
          const currentTaskId = get().currentTaskId
          const tasks = state.tasks
            .filter(task => !ghostIds.has(task.id) || task.id === currentTaskId)
            .map(task => (task.batchId === batchId ? (mergedBatchMap.get(task.id) || task) : task))
          for (const task of mergedBatchTasks) {
            if (!existingMap.has(task.id))
              tasks.unshift(task)
          }
          tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          const nextControlState = resolveBatchControlState(controlState, summary)
          const batchGroups = buildBatchGroups(tasks, state.batchGroups).map(group =>
            group.id === batchId
              ? {
                  ...group,
                  name: batchName || group.name,
                  total: summary.total,
                  success: summary.success,
                  failed: summary.failed,
                  pending: summary.pending,
                  paused: summary.paused,
                  canceled: summary.canceled,
                  controlState: nextControlState,
                  taskIds: items.map(item => item.task_id),
                }
              : group,
          )
          return {
            tasks,
            batchGroups,
            batchItems: {
              ...state.batchItems,
              [batchId]: items,
            },
          }
        }),

      upsertHistoryTask: item => {
        const nextTask = createHistoryTask(item)
        set(state => {
          const existingIndex = state.tasks.findIndex(task => task.id === item.task_id)
          const tasks = [...state.tasks]
          if (existingIndex >= 0)
            tasks[existingIndex] = patchHistoryCardTask(tasks[existingIndex], item)
          else tasks.unshift(nextTask)
          tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          return { tasks, batchGroups: buildBatchGroups(tasks, state.batchGroups) }
        })
        return get().tasks.find(task => task.id === item.task_id) || nextTask
      },

      updateBatchProgress: (batchId, progress) =>
        set(state => ({
          batchGroups: state.batchGroups.map(group =>
            group.id === batchId ? { ...group, ...progress } : group,
          ),
        })),

      updateTaskContent: (id, data) =>
        set(state => {
          const tasks = state.tasks.map(task => {
            if (task.id !== id)
              return task
            // 任务已是 SUCCESS 且本次轮询没有带来新的 markdown 内容时跳过，
            // 避免重复版本堆积。但如果带上了真实内容（此前 light 轮询只刷了
            // 状态、没刷标题/正文），必须继续更新，否则卡片永远显示占位标题。
            if (task.status === 'SUCCESS' && data.status === 'SUCCESS' && !data.markdown)
              return task

            if (typeof data.markdown === 'string') {
              const prev = task.markdown
              const newVersion: Markdown = {
                ver_id: `${task.id}-${uuidv4()}`,
                content: data.markdown,
                style: task.formData.style || '',
                model_name: task.formData.model_name || '',
                created_at: new Date().toISOString(),
              }

              const updatedMarkdown = Array.isArray(prev)
                ? [newVersion, ...prev]
                : [
                    newVersion,
                    ...(typeof prev === 'string' && prev
                      ? [{
                          ver_id: `${task.id}-${uuidv4()}`,
                          content: prev,
                          style: task.formData.style || '',
                          model_name: task.formData.model_name || '',
                          created_at: new Date().toISOString(),
                        }]
                      : []),
                  ]

              return { ...task, ...data, markdown: updatedMarkdown }
            }

            return { ...task, ...data }
          })
          return { tasks, batchGroups: buildBatchGroups(tasks, state.batchGroups) }
        }),

      getCurrentTask: () => {
        const currentTaskId = get().currentTaskId
        return get().tasks.find(task => task.id === currentTaskId) || null
      },

      retryTask: async (id, payload): Promise<boolean> => {
        if (!id) {
          toast.error('任务不存在')
          return false
        }
        const task = get().tasks.find(task => task.id === id)
        if (!task)
          return false

        if (task.batchId && !payload) {
          try {
            const latestStatus = await get_task_status(id)
            const nextStatus = parseTaskStatus(latestStatus?.status, task.status)
            if (nextStatus !== task.status) {
              set(state => {
                const tasks = state.tasks.map(current =>
                  current.id === id
                    ? { ...current, status: nextStatus, message: latestStatus?.message || current.message }
                    : current,
                )
                return { tasks, batchGroups: buildBatchGroups(tasks, state.batchGroups) }
              })
            }

            if (nextStatus !== 'FAILED' && nextStatus !== 'RETRYABLE') {
              toast(getRetrySkipReasonLabel('task_not_failed', nextStatus))
              return false
            }

            const response = await batchRetryFailed(task.batchId, id)
            if (!response.count) {
              const skipped = response.skipped?.find(item => item.task_id === id)
              toast(getRetrySkipReasonLabel(skipped?.reason, nextStatus || task.status))
              return false
            }

            set(state => {
              const retriedIds = new Set((response.retried || []).map((item: { task_id: string }) => item.task_id))
              const tasks = state.tasks.map(current =>
                retriedIds.has(current.id)
                  ? { ...current, status: 'PENDING' as TaskStatus, message: '' }
                  : current,
              )
              const batchItems = Object.fromEntries(
                Object.entries(state.batchItems).map(([batchId, items]) => [
                  batchId,
                  items.map(item => retriedIds.has(item.task_id)
                    ? { ...item, status: 'PENDING', message: '' }
                    : item),
                ]),
              )
              return {
                tasks,
                batchItems,
                batchGroups: buildBatchGroups(tasks, state.batchGroups).map(group =>
                  group.id === task.batchId ? { ...group, controlState: 'RUNNING' } : group,
                ),
              }
            })
            toast.success('已重试当前任务')
          } catch (e: unknown) {
            console.error('重试批次任务失败：', e)
            return false
          }
          return true
        }

        const newFormData = payload || task.formData
        try {
          await generateNote({
            video_url: newFormData.video_url,
            platform: newFormData.platform,
            quality: newFormData.quality,
            model_name: newFormData.model_name,
            provider_id: newFormData.provider_id,
            task_id: id,
            format: newFormData.format || [],
            style: newFormData.style || '',
            extras: newFormData.extras,
            screenshot: newFormData.screenshot,
            link: newFormData.link,
            video_interval: newFormData.video_interval,
            grid_size: newFormData.grid_size || [],
          }, { suppressToast: true })
        } catch (error: unknown) {
          const retryError = error as { code?: number; data?: { reason?: string, downloading?: boolean; duplicate_task?: { task_id?: string; source_url?: string } } }
          if (retryError?.data?.reason === 'transcriber_model_not_ready') {
            toast.error(
              retryError?.data?.downloading
                ? '转写模型正在下载中，请稍候再重试'
                : '转写模型尚未下载，请先去「设置 → 音频转写配置」页下载',
            )
            return false
          }
          // 同视频已有更新的 SUCCESS 记录（不同 task_id），用户点「重试」已明确表达
          // 再生成意图，自动带 force_regenerate=true 重试，避免 409 弹窗阻断流程。
          if (retryError?.code === 409 && retryError?.data?.reason === 'duplicate_video_task') {
            try {
              await generateNote({
                video_url: newFormData.video_url,
                platform: newFormData.platform,
                quality: newFormData.quality,
                model_name: newFormData.model_name,
                provider_id: newFormData.provider_id,
                task_id: id,
                format: newFormData.format || [],
                style: newFormData.style || '',
                extras: newFormData.extras,
                screenshot: newFormData.screenshot,
                link: newFormData.link,
                video_interval: newFormData.video_interval,
                grid_size: newFormData.grid_size || [],
                force_regenerate: true,
              }, { suppressToast: true })
            } catch (innerError) {
              console.error('重试任务(自动force_regenerate)失败：', innerError)
              return false
            }
          } else {
            console.error('重试任务失败：', error)
            return false
          }
        }

        set(state => {
          const tasks = state.tasks.map(t =>
            t.id === id
              ? {
                  ...t,
                  formData: newFormData,
                  status: 'PENDING' as TaskStatus,
                  message: '',
                }
              : t,
          )
          return { tasks, batchGroups: buildBatchGroups(tasks, state.batchGroups) }
        })
        return true
      },

      removeTask: async id => {
        const task = get().tasks.find(t => t.id === id)
        set(state => {
          const tasks = state.tasks.filter(task => task.id !== id)
          const batchItems = Object.fromEntries(
            Object.entries(state.batchItems).map(([batchId, items]) => [
              batchId,
              items.filter(item => item.task_id !== id),
            ]),
          )
          const batchGroups = buildBatchGroups(tasks, state.batchGroups).map(group => {
            if (!group.taskIds.includes(id))
              return group

            const batchItem = state.batchItems[group.id]?.find(item => item.task_id === id)
            const status = String(task?.status || batchItem?.status || '').toUpperCase()
            const next = {
              ...group,
              taskIds: group.taskIds.filter(taskId => taskId !== id),
              total: Math.max(0, group.total - 1),
            }
            if (status === 'SUCCESS')
              next.success = Math.max(0, group.success - 1)
            else if (status === 'FAILED' || status === 'RETRYABLE')
              next.failed = Math.max(0, group.failed - 1)
            else if (status === 'PENDING' || status === 'PARSING' || status === 'DOWNLOADING' || status === 'TRANSCRIBING' || status === 'SUMMARIZING' || status === 'FORMATTING' || status === 'SAVING')
              next.pending = Math.max(0, group.pending - 1)
            else if (status === 'PAUSED')
              next.paused = Math.max(0, group.paused - 1)
            else if (status === 'CANCELED')
              next.canceled = Math.max(0, group.canceled - 1)
            return next
          })
          return {
            tasks,
            batchItems,
            batchGroups,
            currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
            focusedBatchId: state.focusedBatchId && !tasks.some(task => task.batchId === state.focusedBatchId)
              ? null
              : state.focusedBatchId,
          }
        })

        try {
          await delete_task({ task_id: id })
        } catch (error) {
          console.error('删除任务失败，刷新本地历史：', error)
          await get().refreshHistoryList()
          throw error
        }
      },

      removeBatchGroup: async batchId => {
        const group = get().batchGroups.find(item => item.id === batchId)
        if (!group)
          return

        const previousState = {
          tasks: get().tasks,
          batchGroups: get().batchGroups,
          currentTaskId: get().currentTaskId,
          focusedBatchId: get().focusedBatchId,
          batchItems: get().batchItems,
        }

        set(state => {
          const tasks = state.tasks.map(task =>
            task.batchId === batchId
              ? { ...task, batchId: undefined, batchName: undefined }
              : task,
          )
          return {
            tasks,
            batchGroups: buildBatchGroups(tasks, state.batchGroups),
            batchItems: Object.fromEntries(
              Object.entries(state.batchItems).filter(([currentBatchId]) => currentBatchId !== batchId),
            ),
            currentTaskId: state.currentTaskId,
            focusedBatchId: state.focusedBatchId === batchId ? null : state.focusedBatchId,
          }
        })

        try {
          await detach_batch_tasks({ batch_id: batchId })
          toast.success(`已移出项目 ${group.name}，笔记已保留`)
        } catch (error) {
          set(previousState)
          toast.error('移出项目失败，请稍后重试')
          throw error
        }
      },

      pauseBatchGroup: async batchId => {
        await batchPause(batchId)
        set(state => ({
          batchGroups: state.batchGroups.map(group =>
            group.id === batchId ? { ...group, controlState: 'PAUSED' } : group,
          ),
        }))
        toast.success('项目已暂停')
      },

      resumeBatchGroup: async (batchId, override) => {
        const response = await batchResume(batchId, override)
        set(state => {
          const resumedIds = new Set((response.resumed || []).map(item => item.task_id))
          const tasks = state.tasks.map(task =>
            resumedIds.has(task.id)
              ? { ...task, status: 'PENDING' as TaskStatus, message: '' }
              : task,
          )
          return {
            tasks,
            batchGroups: buildBatchGroups(tasks, state.batchGroups).map(group =>
              group.id === batchId ? { ...group, controlState: 'RUNNING' } : group,
            ),
          }
        })
        toast.success(response.count ? `已恢复 ${response.count} 个暂停项` : '项目已恢复')
      },

      cancelBatchGroup: async batchId => {
        await batchCancel(batchId)
        set(state => {
          const tasks = state.tasks.map(task =>
            task.batchId === batchId && !['SUCCESS', 'FAILED', 'CANCELED', 'RETRYABLE'].includes(task.status)
              ? { ...task, status: 'CANCELED' as TaskStatus, message: '批次任务已取消' }
              : task,
          )
          return {
            tasks,
            batchGroups: buildBatchGroups(tasks, state.batchGroups).map(group =>
              group.id === batchId ? { ...group, controlState: 'CANCELED' } : group,
            ),
          }
        })
        toast.success('项目已取消')
      },

      clearFailedBatchTasks: async batchId => {
        const response = await batchClearFailed(batchId)
        if (!response.count) {
          toast('当前没有可清理的失败任务')
          return
        }

        const clearedIds = new Set(response.cleared || [])
        set(state => {
          const tasks = state.tasks.filter(task => !clearedIds.has(task.id))
          const batchItems = Object.fromEntries(
            Object.entries(state.batchItems).map(([currentBatchId, items]) => [
              currentBatchId,
              items.filter(item => !clearedIds.has(item.task_id)),
            ]),
          )
          const batchGroups = buildBatchGroups(tasks, state.batchGroups).map(group =>
            group.id === batchId
              ? {
                  ...group,
                  total: Math.max(0, group.total - response.count),
                  failed: Math.max(0, group.failed - response.count),
                  taskIds: group.taskIds.filter(taskId => !clearedIds.has(taskId)),
                }
              : group,
          )
          return {
            tasks,
            batchItems,
            batchGroups,
            currentTaskId: state.currentTaskId && clearedIds.has(state.currentTaskId)
              ? null
              : state.currentTaskId,
          }
        })
        toast.success(`已清理 ${response.count} 个失败任务`)
      },

      retryFailedBatchTasks: async (batchId, override) => {
        const response = await batchRetryFailed(batchId, undefined, override)
        if (!response.count) {
          toast('当前没有可重试的失败任务')
          return
        }

        set(state => {
          const retriedIds = new Set((response.retried || []).map((item: { task_id: string }) => item.task_id))
          const tasks = state.tasks.map(task =>
            retriedIds.has(task.id)
              ? { ...task, status: 'PENDING' as TaskStatus, message: '' }
              : task,
          )
          return {
            tasks,
            batchGroups: buildBatchGroups(tasks, state.batchGroups).map(group =>
              group.id === batchId ? { ...group, controlState: 'RUNNING' } : group,
            ),
          }
        })
        toast.success(`已重试 ${response.count} 个失败任务`)
      },

      clearTasks: () => set({ tasks: [], batchGroups: [], batchItems: {}, currentTaskId: null, loadingTaskId: null, _loadedContentIds: new Set(), keepFormDraft: false, focusedBatchId: null, historyHasMore: true }),

      setHasHydrated: hydrated => set({ hasHydrated: hydrated }),

      hydrateHistory: async () => {
        try {
          const [history, allBatches] = await Promise.all([
            // 首页列表只需标题/状态做卡片展示，light=true 避免读全量
            // note JSON（20×62KB≈1.2MB 磁盘 IO + 解析），全量内容点卡片时再拉。
            getHistory({ limit: HISTORY_PAGE_SIZE, offset: 0, light: true }),
            getAllBatches().catch(() => []),
          ])
          if (!Array.isArray(history) || history.length === 0) {
            set({ historyHasMore: false })
            return
          }

          const restored: Task[] = history.map((item: HistoryItem) => createHistoryTask(item))
          set(state => {
            const merged = [...state.tasks]
            for (const task of restored) {
              const idx = merged.findIndex(existing => existing.id === task.id)
              if (idx >= 0) {
                const existingTask = merged[idx]
                const next = { ...existingTask, ...task }
                // light 数据不带正文/转写/封面：不能覆盖 IndexedDB 里已缓存的完整内容，
                // 否则刷新页面后自动选中的最新笔记正文被洗成空串，预览区显示空占位。
                if (!task.markdown && existingTask.markdown)
                  next.markdown = existingTask.markdown
                if (!task.transcript?.full_text && existingTask.transcript?.full_text)
                  next.transcript = existingTask.transcript
                if (!task.audioMeta?.cover_url && existingTask.audioMeta?.cover_url)
                  next.audioMeta = existingTask.audioMeta
                merged[idx] = next
              }
              else merged.push(task)
            }
            merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            // Build groups from loaded tasks, then merge in any backend batches not yet represented
            const groups = buildBatchGroups(merged, state.batchGroups)
            const groupMap = new Map(groups.map(g => [g.id, g]))
            const unloadedBatchIds: string[] = []
            if (Array.isArray(allBatches)) {
              for (const batch of allBatches) {
                if (!groupMap.has(batch.batch_id)) {
                  unloadedBatchIds.push(batch.batch_id)
                  groupMap.set(batch.batch_id, {
                    id: batch.batch_id,
                    name: batch.batch_name || batch.batch_id,
                    createdAt: new Date().toISOString(),
                    platform: '',
                    total: 0,
                    success: 0,
                    failed: 0,
                    pending: 0,
                    paused: 0,
                    canceled: 0,
                    controlState: null,
                    taskIds: [],
                    filter: 'all',
                  })
                }
              }
            }
            const mergedGroups = [...groupMap.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            const nextCurrentTaskId = state.keepFormDraft
              ? null
              : (state.currentTaskId && merged.some(task => task.id === state.currentTaskId)
                  ? state.currentTaskId
                  : (merged[0]?.id || null))
            return {
              tasks: merged,
              batchGroups: mergedGroups,
              currentTaskId: nextCurrentTaskId,
              historyHasMore: history.length >= HISTORY_PAGE_SIZE,
              hasHydrated: true,
              _unloadedBatchIds: unloadedBatchIds,
            }
          })

          // 自动选中的笔记走一次 setCurrentTask：正文缺失（冷启动/缓存被清）时触发加载，
          // 让预览区显示 loading 而不是停在「输入视频链接…」空占位。
          // 正文已存在时 setCurrentTask 内部会直接返回，不会发请求。
          const autoSelectedId = get().currentTaskId
          if (autoSelectedId) get().setCurrentTask(autoSelectedId)

          // Silently fetch tasks for batches not in the initial page
          // 用 light=true：项目列表只需要状态/标题做卡片展示，全量 markdown/transcript
          // 会让 224 条任务的 batch 返回 12MB+、耗时 20s 卡死页面。
          // 点击具体任务时 setCurrentTask 会再单独拉全量详情。
          const unloaded = get()._unloadedBatchIds || []
          const unloadedBatchHistory = (
            unloaded.length > 0
              ? await Promise.all(
                  unloaded.map(bid => getHistory({ limit: 500, offset: 0, batch_id: bid, light: true }).catch(() => []))
                )
              : []
          ) as HistoryItem[][]

          // 补拉未归入项目的全部单条笔记（batch_id=__none__），
          // 避免它们被项目内的大量任务挤出最近 N 条窗口导致列表显示不全。
          // light=true：列表只要标题/状态；点击卡片时 setCurrentTask 会拉全量正文。
          let singles: HistoryItem[] = []
          try {
            const res = await getHistory({ limit: 500, offset: 0, batch_id: '__none__', light: true }).catch(() => [])
            if (Array.isArray(res)) singles = res
          } catch {
            // 静默：旧后端不支持 __none__ 时跳过
          }

          // 合并 unloaded batches 与 __none__ 补拉为单次 set，减少组件重渲染
          if (unloaded.length > 0 || singles.length > 0) {
            set(state => {
              const merged = [...state.tasks]
              const seen = new Set(merged.map(t => t.id))
              const appendItems = (items: HistoryItem[]) => {
                for (const item of items) {
                  if (!item?.task_id || seen.has(item.task_id)) continue
                  const task = createHistoryTask(item)
                  merged.push(task)
                  seen.add(task.task_id)
                }
              }
              for (const batchHistory of unloadedBatchHistory) {
                if (!Array.isArray(batchHistory)) continue
                appendItems(batchHistory)
              }
              appendItems(singles)
              merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              return {
                tasks: merged,
                batchGroups: buildBatchGroups(merged, get().batchGroups),
                _unloadedBatchIds: [],
              }
            })
          }

          // 强制同步已有 batch 的任务状态：persist 的 batchItems 可能停留在
          // 提交时的 PENDING，不刷新会一直显示"等待中"（实际任务可能已成功/失败）。
          try {
            await get().refreshHistoryList()
          } catch {
            // 静默：下次轮询兜底
          }
        } catch (error) {
          console.error('恢复历史笔记失败:', error)
        }
      },

      refreshHistoryList: async () => {
        try {
          // 轮询只取最近一批，不必全量拉取所有历史（tasks.length 可能几百条，全量查 SQLite 慢）
          const limit = Math.min(get().tasks.length || HISTORY_PAGE_SIZE, 100)
          const history = await getHistory({ limit, offset: 0, light: true })
          if (!Array.isArray(history)) {
            get().setHasHydrated(true)
            return
          }

          // 并行拉取各项目状态（串行会累加延迟：大项目 1.4s × 4 ≈ 5s 卡住轮询）
          const groups = get().batchGroups
          const batchResults = await Promise.all(
            groups.map(async group => {
              try {
                const batch = await getBatchStatus(group.id, { light: true })
                return { group, batch }
              } catch (error) {
                console.error('刷新批量状态失败:', error)
                return null
              }
            })
          )

          // 单次 set 合并所有数据，避免每个 batch 一次 set 导致的
          // buildBatchGroups × N 重复计算 + 组件树级联重渲染（N+1 → 1）
          set(state => {
            // — 1. 合并 history light 数据 —
            const existingMap = new Map(state.tasks.map(task => [task.id, task]))
            const nextTasks: Task[] = history.map((item: HistoryItem) => {
              const existing = existingMap.get(item.task_id)
              return existing ? patchHistoryCardTask(existing, item) : createHistoryTask(item)
            })
            const nextIds = new Set(nextTasks.map(t => t.id))
            const retained = state.tasks.filter(t => !nextIds.has(t.id))
            let mergedTasks = [...retained, ...nextTasks]
            mergedTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

            // — 2. 合并各 batch 的 status 数据（仅 buildBatchGroups 一次） —
            const batchItems: Record<string, HistoryItem[]> = { ...state.batchItems }
            const mergedMap = new Map(mergedTasks.map(task => [task.id, task]))
            let nextBatchGroups = state.batchGroups.map(group => ({ ...group }))
            for (const r of batchResults) {
              if (!r) continue
              const { group, batch } = r
              const items = (batch.items || []) as HistoryItem[]
              // 合并 batch tasks（复用 reconcileBatchStatus 相同逻辑）
              for (const item of items) {
                const existing = mergedMap.get(item.task_id)
                const patched = existing ? patchHistoryCardTask(existing, item) : createHistoryTask(item)
                mergedMap.set(patched.id, patched)
              }
              batchItems[group.id] = items
              // 服务端批次清单为全量：剔除服务端已不存在的终态本地任务（幽灵任务），
              // 否则它们一直留在失败角标里，而清理接口在服务端找不到行、永远提示无任务可清理
              const ghostIds = findGhostBatchTaskIds(
                mergedMap.values(),
                group.id,
                new Set(items.map(item => item.task_id)),
              )
              for (const ghostId of ghostIds) {
                // 正在预览的任务不做幽灵剔除：服务端批次被清理/瞬时空清单时，
                // 避免当前选中的笔记被静默删除、预览选中被清空
                if (ghostId === state.currentTaskId) continue
                mergedMap.delete(ghostId)
              }
              // patch 该 batch 的控制状态和计数
              const target = nextBatchGroups.find(g => g.id === group.id)
              if (target) {
                target.name = batch.batch_name || target.name
                target.total = batch.summary.total
                target.success = batch.summary.success
                target.failed = batch.summary.failed
                target.pending = batch.summary.pending
                target.paused = batch.summary.paused
                target.canceled = batch.summary.canceled
                target.controlState = resolveBatchControlState(batch.control_state, batch.summary)
                target.taskIds = items.map(item => item.task_id)
              }
            }
            mergedTasks = [...mergedMap.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            // buildBatchGroups 只调一次（原来每个 batch 调一次）
            const batchGroups = buildBatchGroups(mergedTasks, nextBatchGroups)

            return {
              tasks: mergedTasks,
              batchGroups,
              batchItems,
              currentTaskId: state.currentTaskId && mergedMap.has(state.currentTaskId) ? state.currentTaskId : null,
              keepFormDraft: state.keepFormDraft,
              historyHasMore: history.length >= limit,
              hasHydrated: true,
            }
          })
        } catch (error) {
          console.error('刷新历史列表失败:', error)
        }
      },

      loadMoreHistory: async () => {
        try {
          const offset = get().tasks.length
          const history = await getHistory({ limit: HISTORY_PAGE_SIZE, offset, light: true })
          if (!Array.isArray(history) || history.length === 0) {
            set({ historyHasMore: false })
            return
          }

          set(state => {
            const existingIds = new Set(state.tasks.map(task => task.id))
            const appended = history
              .filter((item: HistoryItem) => !existingIds.has(item.task_id))
              .map((item: HistoryItem) => createHistoryTask(item))
            const tasks = [...state.tasks, ...appended]
            tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            return {
              tasks,
              batchGroups: buildBatchGroups(tasks, state.batchGroups),
              historyHasMore: history.length >= HISTORY_PAGE_SIZE,
            }
          })
        } catch (error) {
          console.error('加载更多历史失败:', error)
        }
      },

      setCurrentTask: taskId => {
        set({ currentTaskId: taskId, keepFormDraft: false })
        if (!taskId) return
        const task = get().tasks.find(t => t.id === taskId)
        const hasContent = task?.markdown
          && (typeof task.markdown === 'string'
            ? task.markdown.length > 0
            : Array.isArray(task.markdown) && task.markdown.length > 0)
        if (hasContent) {
          // 内容已在内存，立即展示，无需重新拉取
          set({ loadingTaskId: null })
          return
        }
        // light 轮询只带回标题/状态，正文需要单独拉取。
        // 立即置 loadingTaskId 让预览区给出加载反馈，而不是空白占位。
        const loadedIds = get()._loadedContentIds
        if (loadedIds.has(taskId)) {
          set({ loadingTaskId: null })
          return
        }
        set({ loadingTaskId: taskId })
        void (async () => {
          try {
            const item = await getHistoryTask(taskId, { suppressToast: true })
            if (item) {
              loadedIds.add(taskId)
              get().upsertHistoryTask(item)
            }
          } catch {
            // 拉取失败：清除 loading，让预览区回到空占位（下次点击会重试）
          } finally {
            // 只清理自己这条请求的 loading：快速连续点击两条笔记时，
            // 先发出的旧请求后结束，不能清掉新选中笔记仍在进行的加载态
            set(state => (state.loadingTaskId === taskId ? { loadingTaskId: null } : state))
          }
        })()
      },
      setKeepFormDraft: keep => set({ keepFormDraft: keep }),
      setFocusedBatch: batchId => set({ focusedBatchId: batchId }),

      renameBatch: async (batchId: string, newName: string): Promise<boolean> => {
        try {
          await renameBatch(batchId, newName)
          set(state => {
            const tasks = state.tasks.map(t =>
              t.batchId === batchId ? { ...t, batchName: newName } : t,
            )
            const batchGroups = state.batchGroups.map(group =>
              group.id === batchId ? { ...group, name: newName } : group,
            )
            return { tasks, batchGroups }
          })
          return true
        } catch {
          return false
        }
      },

      moveTaskToProject: async (taskId: string, batchId: string, batchName: string): Promise<boolean> => {
        // 空 batchId + 空 batchName = 移出项目：本地要落成 undefined 而不是空字符串，
        // 否则任务会带着 batchId: '' 留在列表里，卡片仍显示"移出当前项目"入口。
        const nextBatchId = batchId || undefined
        const nextBatchName = batchName || undefined
        try {
          await moveTaskToBatch(taskId, batchId, batchName)
          set(state => {
            const tasks = state.tasks.map(t =>
              t.id === taskId ? { ...t, batchId: nextBatchId, batchName: nextBatchName } : t,
            )
            // 移出项目时同步摘掉 batchItems 里的残留条目：项目面板的列表在
            // remote 分支以 batchItems 为准，不清掉的话这条任务仍会出现在
            // 原项目里（该项目的 taskIds 已不包含它）。
            const batchItems = batchId
              ? state.batchItems
              : Object.fromEntries(
                  Object.entries(state.batchItems).map(([id, items]) => [
                    id,
                    items.filter(item => item.task_id !== taskId),
                  ]),
                )
            return { tasks, batchItems, batchGroups: buildBatchGroups(tasks, state.batchGroups) }
          })
          return true
        } catch {
          return false
        }
      },

      fetchAllBatches: async () => {
        let backend: Array<{ batch_id: string, batch_name: string }> = []
        try {
          backend = (await getAllBatches()) || []
        } catch {
          backend = []
        }
        // 后端 /all_batches 只返回至少含一条任务的批次；本地 store 中手动新建的空项目
        // （无任何任务引用）也要出现在「移入项目」下拉里，因此合并两者，本地优先。
        const merged = new Map<string, { batch_id: string, batch_name: string }>()
        for (const batch of backend)
          merged.set(batch.batch_id, batch)
        for (const group of get().batchGroups || [])
          merged.set(group.id, { batch_id: group.id, batch_name: group.name })
        return [...merged.values()]
      },
    }),
    {
      name: 'task-storage',
      partialize: ({ loadingTaskId, _loadedContentIds, ...rest }) => ({
        ...rest,
        hasHydrated: false,
      }),
      storage: taskStoreStorage,
    },
  ),
)
