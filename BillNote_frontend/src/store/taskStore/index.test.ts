import { beforeEach, describe, expect, it } from 'vitest'

import { useTaskStore, type HistoryItem, type TaskFormData } from '@/store/taskStore'

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
})
