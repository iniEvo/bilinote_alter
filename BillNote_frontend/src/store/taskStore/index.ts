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
}

interface TaskStore {
  tasks: Task[]
  batchGroups: BatchTaskGroup[]
  currentTaskId: string | null
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
    return {
      ...existing,
      ...restored,
      formData: restored.formData,
    }
  }

  const incomingAudioMeta = item.result?.audio_meta || {}
  return {
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
}

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
  // 保留上一轮存在的、没有任何任务引用的项目组（如手动新建的空项目），避免重建时丢失
  for (const prev of previousGroups) {
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
            },
            ...state.batchGroups.filter(group => group.id !== batchId),
          ],
        }))
        return batchId
      },

      getBatchItems: batchId => get().batchItems[batchId] || [],

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
          const tasks = state.tasks
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
          const retryError = error as { data?: { reason?: string, downloading?: boolean } }
          if (retryError?.data?.reason === 'transcriber_model_not_ready') {
            toast.error(
              retryError?.data?.downloading
                ? '转写模型正在下载中，请稍候再重试'
                : '转写模型尚未下载，请先去「设置 → 音频转写配置」页下载',
            )
            return false
          }
          console.error('重试任务失败：', error)
          return false
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

      clearTasks: () => set({ tasks: [], batchGroups: [], batchItems: {}, currentTaskId: null, keepFormDraft: false, focusedBatchId: null, historyHasMore: true }),

      setHasHydrated: hydrated => set({ hasHydrated: hydrated }),

      hydrateHistory: async () => {
        try {
          const [history, allBatches] = await Promise.all([
            getHistory({ limit: HISTORY_PAGE_SIZE, offset: 0 }),
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
              if (idx >= 0)
                merged[idx] = { ...merged[idx], ...task }
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

          // Silently fetch tasks for batches not in the initial page
          const unloaded = get()._unloadedBatchIds || []
          if (unloaded.length > 0) {
            const batchResults = await Promise.all(
              unloaded.map(bid => getHistory({ limit: 500, offset: 0, batch_id: bid }).catch(() => []))
            )
            set(state => {
              const merged = [...state.tasks]
              for (const batchHistory of batchResults) {
                if (!Array.isArray(batchHistory)) continue
                for (const item of batchHistory) {
                  const task = createHistoryTask(item)
                  const idx = merged.findIndex(existing => existing.id === task.id)
                  if (idx >= 0) merged[idx] = { ...merged[idx], ...task }
                  else merged.push(task)
                }
              }
              merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              return {
                tasks: merged,
                batchGroups: buildBatchGroups(merged, get().batchGroups),
                _unloadedBatchIds: [],
              }
            })
          }

          // 补拉未归入项目的全部单条笔记（batch_id=__none__），
          // 避免它们被项目内的大量任务挤出最近 N 条窗口导致列表显示不全
          try {
            const singles = await getHistory({ limit: 500, offset: 0, batch_id: '__none__' }).catch(() => [])
            if (Array.isArray(singles) && singles.length > 0) {
              set(state => {
                const merged = [...state.tasks]
                for (const item of singles) {
                  const task = createHistoryTask(item)
                  const idx = merged.findIndex(existing => existing.id === task.id)
                  if (idx >= 0) merged[idx] = { ...merged[idx], ...task }
                  else merged.push(task)
                }
                merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                return {
                  tasks: merged,
                  batchGroups: buildBatchGroups(merged, get().batchGroups),
                }
              })
            }
          } catch {
            // 静默：旧后端不支持 __none__ 时跳过
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

          set(state => {
            const existingMap = new Map(state.tasks.map(task => [task.id, task]))
            const nextTasks: Task[] = history.map((item: HistoryItem) => {
              const existing = existingMap.get(item.task_id)
              return existing ? patchHistoryCardTask(existing, item) : createHistoryTask(item)
            })

            // 合并而不是替换：保留 store 中已有但不在本次轮询结果里的任务
            //（例如通过 __none__ 补拉进来的无项目笔记，轮询的最近 100 条
            //  可能覆盖不到它们）。轮询只更新后端返回的任务，不删除本地已加载的。
            const nextIds = new Set(nextTasks.map(t => t.id))
            const retained = state.tasks.filter(t => !nextIds.has(t.id))
            const merged = [...retained, ...nextTasks]
            merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

            return {
              tasks: merged,
              batchGroups: buildBatchGroups(merged, state.batchGroups),
              currentTaskId: state.currentTaskId,
              keepFormDraft: state.keepFormDraft,
              historyHasMore: history.length >= limit,
              hasHydrated: true,
            }
          })

          for (const group of get().batchGroups) {
            try {
              const batch = await getBatchStatus(group.id, { light: true })
              get().reconcileBatchStatus(
                group.id,
                batch.items as HistoryItem[],
                {
                  id: group.id,
                  name: batch.batch_name || group.name,
                  createdAt: group.createdAt,
                  platform: group.platform,
                  total: batch.summary.total,
                  success: batch.summary.success,
                  failed: batch.summary.failed,
                  pending: batch.summary.pending,
                  paused: batch.summary.paused,
                  canceled: batch.summary.canceled,
                  controlState: batch.control_state,
                  taskIds: group.taskIds,
                },
                batch.control_state,
                batch.batch_name,
              )
            } catch (error) {
              console.error('刷新批量状态失败:', error)
            }
          }
        } catch (error) {
          console.error('刷新历史列表失败:', error)
        }
      },

      loadMoreHistory: async () => {
        try {
          const offset = get().tasks.length
          const history = await getHistory({ limit: HISTORY_PAGE_SIZE, offset })
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
        // 点击卡片时若内存中该任务没有完整正文（light 轮询只带回 result=null），
        // 主动补拉全量详情，避免预览区空白。
        if (!taskId) return
        const task = get().tasks.find(t => t.id === taskId)
        const hasContent = task?.markdown
          && (typeof task.markdown === 'string'
            ? task.markdown.length > 0
            : Array.isArray(task.markdown) && task.markdown.length > 0)
        if (hasContent) return
        void (async () => {
          try {
            const item = await getHistoryTask(taskId, { suppressToast: true })
            if (item) get().upsertHistoryTask(item)
          } catch {
            // 静默：下次轮询/点击兜底
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
        try {
          await moveTaskToBatch(taskId, batchId, batchName)
          set(state => {
            const tasks = state.tasks.map(t =>
              t.id === taskId ? { ...t, batchId, batchName } : t,
            )
            return { tasks, batchGroups: buildBatchGroups(tasks, state.batchGroups) }
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
      partialize: state => ({
        ...state,
        hasHydrated: false,
      }),
      storage: taskStoreStorage,
    },
  ),
)
