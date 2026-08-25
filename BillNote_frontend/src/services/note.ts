import request from '@/utils/request'
import toast from 'react-hot-toast'
import type { AudioMeta, TaskFormData, Transcript } from '@/store/taskStore'

export interface GenerateNotePayload {
  video_url: string
  platform: string
  quality: string
  model_name: string
  provider_id: string
  task_id?: string
  format: string[]
  style: string
  extras?: string
  video_understand?: boolean
  video_interval?: number
  grid_size: number[]
  screenshot?: boolean
  link?: boolean
  force_regenerate?: boolean
}

export interface GenerateBatchPayload extends Omit<GenerateNotePayload, 'video_url' | 'task_id'> {
  video_urls: string[]
  duplicate_strategy?: 'skip' | 'continue_all' | 'confirm'
  duplicate_confirm_urls?: string[]
}

const sanitizeBatchPayload = (data: GenerateBatchPayload): GenerateBatchPayload => {
  const uniqueUrls = Array.from(new Set((data.video_urls || []).map(url => String(url).trim()).filter(Boolean)))
  return {
    ...data,
    video_urls: uniqueUrls,
    duplicate_confirm_urls: data.duplicate_confirm_urls
      ? Array.from(new Set(data.duplicate_confirm_urls.map(url => String(url).trim()).filter(Boolean)))
      : undefined,
  }
}

export interface BatchTaskSummary {
  total: number
  success: number
  failed: number
  pending: number
  paused: number
  canceled: number
}

export interface BatchTaskResult {
  markdown?: string
  transcript?: Transcript
  audio_meta?: Partial<AudioMeta>
}

export interface BatchTaskItem {
  task_id: string
  video_id?: string
  batch_id?: string
  batch_name?: string
  source_url?: string
  video_url?: string
  title?: string
  platform?: string
  status?: string
  message?: string
  created_at?: string
  result?: BatchTaskResult
  request_payload?: Partial<TaskFormData>
  duplicate_task?: DuplicateTaskInfo
  skipped?: boolean
  needs_confirmation?: boolean
}

export interface DuplicateTaskInfo {
  task_id: string
  video_id?: string
  source_url?: string
  platform?: string
  batch_id?: string
  batch_name?: string
  status?: string
  message?: string
  title?: string
  created_at?: string
  result_exists?: boolean
  request_payload?: Record<string, unknown>
}

export interface BatchStatusResponse {
  batch_id: string
  batch_name?: string
  control_state?: 'RUNNING' | 'PAUSED' | 'CANCELED' | null
  summary: BatchTaskSummary
  items: BatchTaskItem[]
}

export interface GenerateNoteOptions {
  suppressToast?: boolean
}

export const generateNote = async (data: GenerateNotePayload, options: GenerateNoteOptions = {}) => {
  try {
    const response = await request.post('/generate_note', data, {
      suppressToast: options.suppressToast === true,
    })
    toast.success('笔记生成任务已提交！')
    return response
  } catch (e: unknown) {
    console.error('❌ 请求出错', e)
    if (options.suppressToast) {
      const payload = typeof e === 'object' && e !== null
        ? e as { code?: unknown, msg?: unknown }
        : {}
      const expectedHandledCodes = new Set([300102, 300103, 409])
      if (!expectedHandledCodes.has(payload.code as number))
        toast.error(typeof payload.msg === 'string' ? payload.msg : '提交任务失败，请稍后重试')
    }
    throw e
  }
}

export const generateNotesBatch = async (data: GenerateBatchPayload) => {
  try {
    const payload = sanitizeBatchPayload(data)
    const response = await request.post('/generate_notes_batch', payload) as {
      batch_id: string
      batch_name?: string
      tasks?: BatchTaskItem[]
    }
    toast.success(`已提交 ${response.tasks?.length || 0} 个批量任务`)
    return { ...response, tasks: response.tasks || [] }
  } catch (e: unknown) {
    console.error('❌ 批量提交出错', e)
    throw e
  }
}

export const getBatchStatus = async (batchId: string) => {
  return await request.get(`/batch_status/${batchId}`) as BatchStatusResponse
}

export const batchPause = async (batchId: string) => {
  return await request.post('/batch_pause', { batch_id: batchId })
}

export const batchResume = async (batchId: string) => {
  return await request.post('/batch_resume', { batch_id: batchId }) as {
    batch_id: string
    count: number
    control_state: 'RUNNING'
    resumed: Array<{ task_id: string, video_url?: string }>
  }
}

export const batchCancel = async (batchId: string) => {
  return await request.post('/batch_cancel', { batch_id: batchId })
}

export const batchClearFailed = async (batchId: string) => {
  return await request.post('/batch_clear_failed', { batch_id: batchId }) as {
    batch_id: string
    count: number
    cleared: string[]
  }
}

export const batchRetryFailed = async (batchId: string, taskId?: string) => {
  return await request.post('/batch_retry_failed', {
    batch_id: batchId,
    ...(taskId ? { task_id: taskId } : {}),
  }) as {
    batch_id: string
    count: number
    retried: Array<{ task_id: string, video_url?: string }>
    skipped?: Array<{ task_id: string, video_url?: string, reason?: string }>
  }
}

export const delete_task = async ({ task_id }: { task_id: string }) => {
  try {
    const res = await request.post('/delete_task', { task_id })
    toast.success('任务已成功删除')
    return res
  } catch (e) {
    toast.error('请求异常，删除任务失败')
    console.error('❌ 删除任务失败:', e)
    throw e
  }
}

export const detach_batch_tasks = async ({ batch_id }: { batch_id: string }) => {
  try {
    return await request.post('/detach_batch_tasks', { batch_id }) as { batch_id: string, count: number }
  } catch (e) {
    toast.error('请求异常，批次移除失败')
    console.error('❌ 批次移除失败:', e)
    throw e
  }
}

export const get_task_status = async (task_id: string) => {
  try {
    return await request.get(`/task_status/${task_id}`, { suppressToast: true }) as {
      status?: string
      message?: string
    }
  } catch (e) {
    console.error('❌ 请求出错', e)
    throw e
  }
}

export interface FixNoteTitlesResult {
  total_checked: number
  fixed_count: number
  local_fixed: Array<{ task_id: string, title: string }>
  online_fixed: Array<{ task_id: string, title: string }>
  failed: Array<{ task_id: string, reason?: string }>
}

export const fixNoteTitles = async (fetchOnline = false) => {
  return await request.post('/fix_note_titles', { fetch_online: fetchOnline }) as FixNoteTitlesResult
}

export const getHistory = async (params?: { limit?: number, offset?: number, include_pending?: boolean }) => {
  return await request.get('/history', { params })
}

export interface HistoryTaskOptions {
  suppressToast?: boolean
}

export const getHistoryTask = async (taskId: string, options: HistoryTaskOptions = {}) => {
  return await request.get(`/history/${taskId}`, {
    suppressToast: options.suppressToast === true,
  }) as BatchTaskItem
}
