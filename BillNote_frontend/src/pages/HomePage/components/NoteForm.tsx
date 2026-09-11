/* NoteForm.tsx ---------------------------------------------------- */
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form.tsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Info, Layers, Loader2, Plus, Sparkles, Upload, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert.tsx'
import {
  generateNote,
  generateNotesBatch,
  getHistoryTask,
  type BatchTaskItem,
  type DuplicateTaskInfo,
  type GenerateBatchPayload,
  type GenerateNotePayload,
} from '@/services/note.ts'
import type { TaskStatus } from '@/store/taskStore'
import { uploadFile } from '@/services/upload.ts'
import { useTaskStore } from '@/store/taskStore'
import { useModelStore } from '@/store/modelStore'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { noteFormats, noteStyles, videoPlatforms } from '@/constant/note.ts'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

const getErrorPayload = (error: unknown): Record<string, unknown> =>
  typeof error === 'object' && error !== null ? error as Record<string, unknown> : {}

const KNOWN_TASK_STATUSES = new Set<TaskStatus>([
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
])

const formSchema = z
  .object({
    video_url: z.string().optional(),
    batch_video_urls: z.string().optional(),
    platform: z.string().nonempty('请选择平台'),
    quality: z.enum(['fast', 'medium', 'slow']),
    screenshot: z.boolean().optional(),
    link: z.boolean().optional(),
    model_name: z.string().nonempty('请选择模型'),
    format: z.array(z.string()).default([]),
    style: z.string().nonempty('请选择笔记生成风格'),
    extras: z.string().optional(),
    video_understanding: z.boolean().optional(),
    video_interval: z.number().min(1).max(30).default(6).optional(),
    grid_size: z
      .tuple([z.number().min(1).max(10), z.number().min(1).max(10)])
      .default([2, 2])
      .optional(),
  })
  .superRefine(({ video_url, batch_video_urls, platform }, ctx) => {
    const single = (video_url || '').trim()
    const batch = (batch_video_urls || '').trim()
    const lines = batch.split('\n').map(line => line.trim()).filter(Boolean)

    if (!single && lines.length === 0) {
      ctx.addIssue({ code: 'custom', message: '请填写至少一个视频链接', path: ['video_url'] })
      return
    }

    if (platform === 'local') {
      if (!single) {
        ctx.addIssue({ code: 'custom', message: '本地视频路径不能为空', path: ['video_url'] })
      }
      if (lines.length > 0) {
        ctx.addIssue({ code: 'custom', message: '本地视频暂不支持批量输入', path: ['batch_video_urls'] })
      }
      return
    }

    const validateHttpUrl = (value: string, path: 'video_url' | 'batch_video_urls') => {
      try {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error()
      } catch {
        ctx.addIssue({ code: 'custom', message: '请输入正确的视频链接', path: [path] })
      }
    }

    if (single)
      validateHttpUrl(single, 'video_url')

    for (const line of lines)
      validateHttpUrl(line, 'batch_video_urls')
  })

export type NoteFormValues = z.infer<typeof formSchema>

const SectionHeader = ({ title, tip }: { title: string, tip?: string }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <span className="inline-flex h-2 w-2 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 shadow-[0_0_6px_rgba(59,130,246,0.5)]" aria-hidden="true" />
      <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
    </div>
    {tip && (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${title}说明`}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-[color,background-color,transform] hover:bg-blue-50 hover:text-primary active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60 text-xs">{tip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )}
  </div>
)

const CheckboxGroup = ({
  value = [],
  onChange,
  disabledMap,
}: {
  value?: string[]
  onChange: (v: string[]) => void
  disabledMap: Record<string, boolean>
}) => (
  <div className="flex flex-wrap gap-2">
    {noteFormats.map(({ label, value: v }) => (
      <label
        key={v}
        className={[
          'inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-[border-color,background-color,color,box-shadow,transform] active:scale-[0.97]',
          disabledMap[v]
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
            : value.includes(v)
              ? 'border-blue-300 bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100'
              : 'border-slate-200 bg-white text-slate-600 hover:-translate-y-px hover:border-blue-200 hover:bg-blue-50/50 hover:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring/50',
        ].join(' ')}
      >
        <Checkbox
          checked={value.includes(v)}
          disabled={disabledMap[v]}
          onCheckedChange={checked =>
            onChange(checked ? [...value, v] : value.filter(x => x !== v))}
        />
        <span>{label}</span>
      </label>
    ))}
  </div>
)

const NoteForm = () => {
  const navigate = useNavigate()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false)
  const [pendingDuplicatePayload, setPendingDuplicatePayload] = useState<GenerateNotePayload | null>(null)
  const [duplicateTaskInfo, setDuplicateTaskInfo] = useState<DuplicateTaskInfo | null>(null)
  const [batchDuplicateItems, setBatchDuplicateItems] = useState<BatchTaskItem[]>([])
  const [batchDuplicatePayload, setBatchDuplicatePayload] = useState<GenerateBatchPayload | null>(null)
  const [lastSubmittedBatchId, setLastSubmittedBatchId] = useState<string | null>(null)
  const [lastSubmittedBatchTaskId, setLastSubmittedBatchTaskId] = useState<string | null>(null)
  const [duplicateFlowMode, setDuplicateFlowMode] = useState<'single' | 'batch'>('single')
  const [batchDuplicateProgress, setBatchDuplicateProgress] = useState({ total: 0, handled: 0, skipped: 0, continued: 0 })
  const [continuingRemainingDuplicates, setContinuingRemainingDuplicates] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [projects, setProjects] = useState<Array<{ batch_id: string, batch_name: string }>>([])
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [newBatchName, setNewBatchName] = useState('')
  const {
    addBatchGroup,
    addPendingTask,
    keepFormDraft,
    setCurrentTask,
    setKeepFormDraft,
    retryTask,
    upsertHistoryTask,
    updateTaskContent,
    fetchAllBatches,
  } = useTaskStore()
  // 只订阅当前任务对象本身（zustand 按引用比较），
  // 而不是整份 store：轮询更新 tasks 数组里的其他任务时，
  // 当前任务引用不变则 NoteForm 不重渲染，避免打字卡顿。
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const currentTask = useTaskStore(state => state.tasks.find(t => t.id === state.currentTaskId) || null)
  const { loadEnabledModels, modelList } = useModelStore()
  const uniqueModels = useMemo(
    () => modelList.filter((model, index, list) => list.findIndex(item => item.model_name === model.model_name) === index),
    [modelList],
  )

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      platform: 'bilibili',
      quality: 'medium',
      model_name: uniqueModels[0]?.model_name || '',
      style: 'minimal',
      video_interval: 6,
      grid_size: [2, 2],
      format: [],
      video_url: '',
      batch_video_urls: '',
    },
  })
  const platform = useWatch({ control: form.control, name: 'platform' }) as string
  const videoUnderstandingEnabled = useWatch({ control: form.control, name: 'video_understanding' })
  const editing = !keepFormDraft && !!currentTask?.id
  const batchText = useWatch({ control: form.control, name: 'batch_video_urls' }) || ''
  const batchCount = useMemo(
    () => new Set(batchText.split('\n').map(line => line.trim()).filter(Boolean)).size,
    [batchText],
  )
  const videoUrl = useWatch({ control: form.control, name: 'video_url' }) || ''
  const batchMode = batchCount + (videoUrl.trim() ? 1 : 0) > 1

  const goModelAdd = () => {
    navigate('/settings/model')
  }

  useEffect(() => {
    loadEnabledModels()
  }, [loadEnabledModels])

  useEffect(() => {
    let active = true
    fetchAllBatches()
      .then((list) => {
        if (active) setProjects(Array.isArray(list) ? list as Array<{ batch_id: string, batch_name: string }> : [])
      })
      .catch(() => {})
    return () => { active = false }
  }, [fetchAllBatches])

  useEffect(() => {
    if (uniqueModels.length === 0)
      return
    const selectedModel = form.getValues('model_name')
    const selectedExists = uniqueModels.some(model => model.model_name === selectedModel)
    if (!selectedModel || !selectedExists) {
      form.setValue('model_name', uniqueModels[0]?.model_name || '', {
        shouldDirty: true,
        shouldValidate: true,
      })
      if (selectedModel && !selectedExists)
        toast.error('当前已选模型已失效，已自动切换到可用模型，请确认后再提交')
    }
  }, [uniqueModels, form])

  useEffect(() => {
    if (!currentTask)
      return
    const { formData } = currentTask
    const sanitizedVideoUnderstanding = sanitizeVideoUnderstandingValues(formData)
    form.reset({
      platform: formData.platform || 'bilibili',
      video_url: formData.video_url || '',
      batch_video_urls: '',
      model_name: formData.model_name || uniqueModels[0]?.model_name || '',
      style: formData.style || 'minimal',
      quality: formData.quality || 'medium',
      extras: formData.extras || '',
      screenshot: formData.screenshot ?? false,
      link: formData.link ?? false,
      video_understanding: formData.video_understanding ?? false,
      video_interval: sanitizedVideoUnderstanding.video_interval,
      grid_size: sanitizedVideoUnderstanding.grid_size,
      format: formData.format ?? [],
    })
  }, [currentTask, currentTaskId, uniqueModels, form])

  const activeTask = keepFormDraft ? null : currentTask
  const generating = !['SUCCESS', 'FAILED', 'RETRYABLE', undefined].includes(activeTask?.status)

  const handleFileUpload = async (file: File, cb: (url: string) => void) => {
    const formData = new FormData()
    formData.append('file', file)
    setIsUploading(true)
    setUploadSuccess(false)

    try {
      const data = await uploadFile(formData)
      cb(data.url)
      setUploadSuccess(true)
    } catch (err) {
      console.error('上传失败:', err)
    } finally {
      setIsUploading(false)
    }
  }

  const parsePositiveInt = (event: ChangeEvent<HTMLInputElement>, fallback: number) => {
    const raw = event.target.value.trim()
    if (raw === '')
      return fallback
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  const sanitizeVideoUnderstandingValues = (values: Partial<NoteFormValues>) => {
    const videoInterval = typeof values.video_interval === 'number' && values.video_interval >= 1 && values.video_interval <= 30
      ? values.video_interval
      : 6

    const rawGrid = values.grid_size
    const columns = typeof rawGrid?.[0] === 'number' && rawGrid[0] >= 1 && rawGrid[0] <= 10
      ? rawGrid[0]
      : 2
    const rows = typeof rawGrid?.[1] === 'number' && rawGrid[1] >= 1 && rawGrid[1] <= 10
      ? rawGrid[1]
      : 2

    return {
      video_interval: videoInterval,
      grid_size: [columns, rows] as [number, number],
    }
  }

  const parseTaskStatus = (value: unknown): TaskStatus => {
    if (typeof value === 'string' && KNOWN_TASK_STATUSES.has(value as TaskStatus))
      return value as TaskStatus
    return 'PENDING'
  }

  const ensureExistingTaskVisible = async (
    taskId: string,
    fallback: {
      platform: string
      videoUrl: string
      batchId?: string
      batchName?: string
      sourceUrl?: string
      status?: unknown
      message?: unknown
      requestPayload?: Record<string, unknown>
    },
  ) => {
    const existingTask = useTaskStore.getState().tasks.find(task => task.id === taskId)
    if (existingTask) {
      updateTaskContent(taskId, {
        status: parseTaskStatus(fallback.status),
        message: typeof fallback.message === 'string' ? fallback.message : existingTask.message,
      })
      return existingTask
    }

    try {
      const task = await getHistoryTask(taskId, { suppressToast: true })
      return upsertHistoryTask(task)
    } catch (error) {
      console.warn('加载已有任务详情失败，回退到本地占位卡片：', error)
      const requestPayload = fallback.requestPayload || {}
      addPendingTask(
        taskId,
        fallback.platform,
        {
          video_url: fallback.videoUrl,
          link: typeof requestPayload.link === 'boolean' ? requestPayload.link : false,
          screenshot: typeof requestPayload.screenshot === 'boolean' ? requestPayload.screenshot : false,
          platform: String(requestPayload.platform || fallback.platform),
          quality: String(requestPayload.quality || 'fast'),
          model_name: String(requestPayload.model_name || ''),
          provider_id: String(requestPayload.provider_id || ''),
          style: typeof requestPayload.style === 'string' ? requestPayload.style : '',
          format: Array.isArray(requestPayload.format)
            ? requestPayload.format.filter(item => typeof item === 'string') as string[]
            : [],
          extras: typeof requestPayload.extras === 'string' ? requestPayload.extras : undefined,
          video_understanding: typeof requestPayload.video_understanding === 'boolean'
            ? requestPayload.video_understanding
            : undefined,
          video_interval: typeof requestPayload.video_interval === 'number'
            ? requestPayload.video_interval
            : undefined,
          grid_size: Array.isArray(requestPayload.grid_size)
            ? requestPayload.grid_size.filter(item => typeof item === 'number').slice(0, 2) as number[]
            : undefined,
        },
        fallback.batchId,
        fallback.sourceUrl || fallback.videoUrl,
        fallback.batchName,
      )
      updateTaskContent(taskId, {
        status: parseTaskStatus(fallback.status),
        message: typeof fallback.message === 'string' ? fallback.message : '',
      })
      return useTaskStore.getState().tasks.find(task => task.id === taskId) || null
    }
  }

  const submitSingleNote = async (payload: GenerateNotePayload, platform: string) => {
    try {
      const data = await generateNote(payload, { suppressToast: true })
      addPendingTask(
        data.task_id,
        platform,
        { ...payload, video_url: payload.video_url },
        payload.batch_id || undefined,
        payload.video_url,
        payload.batch_name || undefined,
      )
      return true
    } catch (e: unknown) {
      const errorPayload = getErrorPayload(e)
      const errorData = getErrorPayload(errorPayload.data)
      if (errorPayload.code === 409 && errorData.reason === 'duplicate_video_task') {
        const duplicateTask = (errorData.duplicate_task || null) as DuplicateTaskInfo | null
        if (duplicateTask?.task_id) {
          await ensureExistingTaskVisible(duplicateTask.task_id, {
            platform,
            videoUrl: duplicateTask.source_url || payload.video_url,
            batchId: duplicateTask.batch_id,
            batchName: duplicateTask.batch_name,
            sourceUrl: duplicateTask.source_url,
            status: duplicateTask.status,
            message: duplicateTask.message,
            requestPayload: duplicateTask.request_payload as Record<string, unknown> | undefined,
          })
        }
        setDuplicateFlowMode('single')
        setPendingDuplicatePayload(payload)
        setDuplicateTaskInfo(duplicateTask)
        setDuplicateConfirmOpen(true)
        return false
      }
      if (errorPayload.code === 300103 && typeof errorData.task_id === 'string') {
        const task = await ensureExistingTaskVisible(errorData.task_id, {
          platform,
          videoUrl: payload.video_url,
          status: 'PENDING',
          message: typeof errorPayload.msg === 'string' ? errorPayload.msg : '同一视频正在生成中，请等待当前任务完成后再试',
          requestPayload: payload as unknown as Record<string, unknown>,
        })
        setCurrentTask(task?.id || errorData.task_id)
        toast('已定位到正在执行的任务卡片')
        return false
      }
      throw e
    }
  }

  const onSubmit = async (values: NoteFormValues) => {
    if (isSubmitting || generating)
      return

    const model = modelList.find(m => m.model_name === values.model_name)
    if (!model) {
      toast.error('所选模型不存在，请重新选择')
      return
    }

    // ── 项目解析 ──
    let finalBatchId: string | undefined
    let finalBatchName = ''
    if (selectedBatchId === '__new__') {
      const name = newBatchName.trim()
      if (!name) { toast.error('请输入新项目名称'); return }
      finalBatchId = crypto.randomUUID()
      finalBatchName = name
    } else if (selectedBatchId) {
      finalBatchId = selectedBatchId
      finalBatchName = projects.find(p => p.batch_id === selectedBatchId)?.batch_name || ''
    }

    const batchUrls = Array.from(new Set((values.batch_video_urls || '').split('\n').map(line => line.trim()).filter(Boolean)))
    const singleUrl = values.video_url?.trim()
    const allUrls = [singleUrl, ...batchUrls].filter(Boolean) as string[]

    const sanitizedVideoUnderstanding = sanitizeVideoUnderstandingValues(values)
    const commonPayload = {
      platform: values.platform,
      quality: values.quality,
      model_name: values.model_name,
      provider_id: model.provider_id,
      format: values.format,
      style: values.style,
      extras: values.extras,
      video_understanding: values.video_understanding,
      video_interval: sanitizedVideoUnderstanding.video_interval,
      grid_size: sanitizedVideoUnderstanding.grid_size,
      screenshot: values.screenshot,
      link: values.link,
      ...(finalBatchId ? { batch_id: finalBatchId, batch_name: finalBatchName } : {}),
    }

    const currentStoreTask = currentTaskId
      ? useTaskStore.getState().tasks.find(task => task.id === currentTaskId) || null
      : null
    const retryVideoUrl = singleUrl || currentStoreTask?.formData?.video_url || ''
    const canRetryCurrentTask = Boolean(
      currentStoreTask
      && allUrls.length <= 1
      && retryVideoUrl
      && retryVideoUrl === currentStoreTask.formData.video_url
      && ['PENDING', 'FAILED', 'RETRYABLE', 'PAUSED', 'CANCELED', 'SUCCESS'].includes(currentStoreTask.status),
    )

    setIsSubmitting(true)
    try {
      if (currentTaskId && allUrls.length <= 1) {
        if (!canRetryCurrentTask) {
          setCurrentTask(null)
        } else {
          const retried = await retryTask(currentTaskId, { ...commonPayload, video_url: retryVideoUrl, task_id: currentTaskId })
          if (!retried && !useTaskStore.getState().tasks.find(task => task.id === currentTaskId))
            setCurrentTask(null)
          return
        }
      }

      if (allUrls.length > 1) {
        await submitBatchWithStrategy({
          ...commonPayload,
          video_urls: allUrls,
        }, 'confirm')
        return
      }

      await submitSingleNote({
        ...commonPayload,
        video_url: singleUrl || '',
        task_id: currentTaskId || '',
      }, values.platform)
    } catch (e: unknown) {
      const errorPayload = getErrorPayload(e)
      const errorData = getErrorPayload(errorPayload.data)
      if (errorData.reason === 'transcriber_model_not_ready') {
        const downloading = Boolean(errorData.downloading)
        toast.error(
          downloading
            ? '转写模型正在下载中，请稍候再提交'
            : '转写模型尚未下载，请先去「音频转写配置」页下载',
        )
        if (!downloading)
          navigate('/settings/transcriber')
        return
      }
      if (e?.data?.reason === 'douyin_video_id_unparseable') {
        toast.error('当前链接无法解析出抖音视频 ID，请确认链接完整，或使用 /video/xxx、短链、包含 modal_id 的分享链接')
        return
      }
      console.error('提交任务失败：', e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const onInvalid = (errors: FieldErrors<NoteFormValues>) => {
    console.warn('表单校验失败：', errors)

    const repaired = sanitizeVideoUnderstandingValues(form.getValues())
    form.setValue('video_interval', repaired.video_interval, { shouldValidate: false })
    form.setValue('grid_size', repaired.grid_size, { shouldValidate: false })

    if (errors.model_name) {
      toast.error(errors.model_name.message || '请选择有效的模型后再生成笔记')
      return
    }
    if (errors.video_interval) {
      toast.error(errors.video_interval.message || '采样间隔需在 1-30 秒之间')
      return
    }
    if (errors.grid_size) {
      toast.error(errors.grid_size.message || '拼图尺寸需填写列和行，且取值范围为 1-10')
      return
    }
  }

  const finishBatchDuplicateFlow = () => {
    toast.success(`重复链接处理完成：批次 ${lastSubmittedBatchId?.slice(0, 8) || '-'}，跳过 ${batchDuplicateProgress.skipped} 条，继续生成 ${batchDuplicateProgress.continued} 条`)
    if (lastSubmittedBatchId)
      toast((t) => (
        <div className="flex items-center gap-3">
          <span>可直接查看本批次任务面板</span>
          <Button
            size="small"
            onClick={() => {
              if (lastSubmittedBatchTaskId)
                setCurrentTask(lastSubmittedBatchTaskId)
              setKeepFormDraft(false)
              toast.dismiss(t.id)
            }}
          >
            查看本批次
          </Button>
        </div>
      ), { duration: 5000 })
    setBatchDuplicateItems([])
    setBatchDuplicatePayload(null)
    setBatchDuplicateProgress({ total: 0, handled: 0, skipped: 0, continued: 0 })
    setDuplicateConfirmOpen(false)
    setPendingDuplicatePayload(null)
    setDuplicateTaskInfo(null)
    setContinuingRemainingDuplicates(false)
  }

  const showNextBatchDuplicate = (items: BatchTaskItem[], payload: GenerateBatchPayload) => {
    const [current, ...rest] = items
    if (!current) {
      finishBatchDuplicateFlow()
      return
    }
    setDuplicateFlowMode('batch')
    setBatchDuplicateItems(rest)
    setPendingDuplicatePayload({ ...payload, video_url: current.video_url })
    setDuplicateTaskInfo(current.duplicate_task)
    setDuplicateConfirmOpen(true)
  }

  const handleConfirmDuplicate = async () => {
    if (!pendingDuplicatePayload)
      return
    setDuplicateConfirmOpen(false)
    try {
      await submitSingleNote({
        ...pendingDuplicatePayload,
        force_regenerate: true,
      }, pendingDuplicatePayload.platform)
      if (duplicateFlowMode === 'batch' && batchDuplicatePayload) {
        setBatchDuplicateProgress(state => ({
          ...state,
          handled: state.handled + 1,
          continued: state.continued + 1,
        }))
        showNextBatchDuplicate(batchDuplicateItems, batchDuplicatePayload)
      }
      else {
        setPendingDuplicatePayload(null)
        setDuplicateTaskInfo(null)
      }
    } catch (e) {
      console.error('确认重复生成失败：', e)
    }
  }

  const handleSkipDuplicate = () => {
    setDuplicateConfirmOpen(false)
    if (duplicateFlowMode === 'batch' && batchDuplicatePayload) {
      setBatchDuplicateProgress(state => ({
        ...state,
        handled: state.handled + 1,
        skipped: state.skipped + 1,
      }))
      showNextBatchDuplicate(batchDuplicateItems, batchDuplicatePayload)
      return
    }
    setPendingDuplicatePayload(null)
    setDuplicateTaskInfo(null)
  }

  const handleSkipAllRemainingDuplicates = () => {
    if (duplicateFlowMode !== 'batch')
      return
    setDuplicateConfirmOpen(false)
    setBatchDuplicateProgress(state => ({
      ...state,
      handled: state.total,
      skipped: state.skipped + batchDuplicateItems.length + 1,
    }))
    setBatchDuplicateItems([])
    finishBatchDuplicateFlow()
  }

  const handleContinueAllRemainingDuplicates = async () => {
    if (continuingRemainingDuplicates || duplicateFlowMode !== 'batch' || !batchDuplicatePayload || !pendingDuplicatePayload)
      return
    setContinuingRemainingDuplicates(true)
    setDuplicateConfirmOpen(false)
    try {
      const confirmUrls = [
        pendingDuplicatePayload.video_url,
        ...batchDuplicateItems.map(item => item.video_url).filter(Boolean),
      ]
      const batch = await generateNotesBatch({
        ...batchDuplicatePayload,
        video_urls: confirmUrls,
        duplicate_strategy: 'confirm',
        duplicate_confirm_urls: confirmUrls,
      })
      const taskIds: string[] = []
      for (const item of batch.tasks) {
        if (!item.task_id || item.skipped || item.needs_confirmation)
          continue
        taskIds.push(item.task_id)
        addPendingTask(item.task_id, batchDuplicatePayload.platform, {
          ...batchDuplicatePayload,
          video_url: item.source_url || item.video_url || '',
        }, batch.batch_id, item.source_url || item.video_url, batch.batch_name)
      }
      if (taskIds.length > 0) {
        addBatchGroup(batch.batch_id, batchDuplicatePayload.platform, taskIds, batch.batch_name)
        setLastSubmittedBatchId(batch.batch_id)
        setLastSubmittedBatchTaskId(taskIds[0])
      }
      setBatchDuplicateProgress(state => ({
        ...state,
        handled: state.total,
        continued: state.continued + confirmUrls.length,
      }))
      setBatchDuplicateItems([])
      finishBatchDuplicateFlow()
    } catch (e) {
      console.error('批量继续剩余重复项失败：', e)
      toast.error('批量继续生成失败，请稍后重试')
    } finally {
      setContinuingRemainingDuplicates(false)
    }
  }

  const handleOpenDuplicateTask = async () => {
    if (!duplicateTaskInfo?.task_id)
      return

    const existingTask = useTaskStore.getState().tasks.find(task => task.id === duplicateTaskInfo.task_id)
    if (!existingTask) {
      try {
        const task = await getHistoryTask(duplicateTaskInfo.task_id)
        upsertHistoryTask(task)
      } catch (error) {
        console.error('加载历史笔记失败：', error)
        toast.error('未能加载上一次笔记，请稍后重试')
        return
      }
    }

    setCurrentTask(duplicateTaskInfo.task_id)
    if (duplicateFlowMode === 'batch' && batchDuplicatePayload) {
      setDuplicateConfirmOpen(false)
      showNextBatchDuplicate(batchDuplicateItems, batchDuplicatePayload)
      return
    }
    setDuplicateConfirmOpen(false)
  }

  const submitBatchWithStrategy = async (payload: GenerateBatchPayload, strategy: 'skip' | 'continue_all' | 'confirm') => {
    const batch = await generateNotesBatch({
      ...payload,
      duplicate_strategy: strategy,
    })
    const taskIds: string[] = []
    const duplicateItems = batch.tasks.filter(item => item.needs_confirmation)
    for (const item of batch.tasks) {
      if (!item.task_id || item.skipped || item.needs_confirmation)
        continue
      taskIds.push(item.task_id)
      addPendingTask(item.task_id, payload.platform, {
        ...payload,
        video_url: item.source_url || item.video_url || '',
      }, batch.batch_id, item.source_url || item.video_url, batch.batch_name)
    }
    if (taskIds.length > 0) {
      addBatchGroup(batch.batch_id, payload.platform, taskIds, batch.batch_name)
      setLastSubmittedBatchId(batch.batch_id)
      setLastSubmittedBatchTaskId(taskIds[0])
    }
    if (duplicateItems.length > 0) {
      setBatchDuplicateItems(duplicateItems)
      setBatchDuplicatePayload(payload)
      setBatchDuplicateProgress({ total: duplicateItems.length, handled: 0, skipped: 0, continued: 0 })
      toast(`有 ${duplicateItems.length} 条重复链接待确认`, { icon: '⚠️' })
    }
    const skipped = batch.tasks.filter(item => item.skipped).length
    if (skipped > 0)
      toast.success(`已跳过 ${skipped} 条重复链接`)
    if (taskIds.length > 0)
      toast.success(`批量任务已提交，共 ${taskIds.length} 条`)
    return batch
  }

  const handleCreateNew = () => {
    setKeepFormDraft(true)
    setCurrentTask(null)
    setSelectedBatchId('')
    setNewBatchName('')
    form.reset({
      ...form.getValues(),
      video_url: '',
      batch_video_urls: '',
    })
  }

  const FormButton = () => {
    const buttonBusy = generating || isSubmitting
    const label = buttonBusy ? '正在生成…' : batchMode ? '批量生成笔记' : editing ? '重新生成' : '生成笔记'

    return (
      <div className="flex gap-3">
        <Button
          type="submit"
          className={[
            !editing ? 'w-full' : 'w-2/3',
            'btn-glow h-11 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/35 hover:brightness-105',
          ].join(' ')}
          disabled={buttonBusy}
        >
          {buttonBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {label}
        </Button>

        {editing && (
          <Button type="button" variant="outline" className="flex h-11 w-1/3 items-center justify-center rounded-xl bg-white" onClick={handleCreateNew}>
            <Plus className="mr-2 h-4 w-4" />
            新建笔记
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="h-full w-full rounded-[24px] border border-white/60 bg-gradient-to-b from-white to-slate-50/80 p-3 shadow-sm md:p-4">
      <Dialog open={duplicateConfirmOpen} onOpenChange={setDuplicateConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>该视频已生成过笔记</DialogTitle>
            <DialogDescription>
              {duplicateFlowMode === 'batch'
                ? `批量任务检测到重复历史，当前按队列逐条确认。第 ${batchDuplicateProgress.handled + 1} / ${batchDuplicateProgress.total} 条，剩余待处理 ${batchDuplicateItems.length + 1} 条。`
                : '检测到这个视频链接已有历史任务。是否确认继续生成新的笔记？'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-neutral-600">
            <div>视频标题：{duplicateTaskInfo?.title || '未命名视频'}</div>
            <div>历史任务 ID：{duplicateTaskInfo?.task_id || '-'}</div>
            <div>历史状态：{duplicateTaskInfo?.status || '-'}</div>
            <div>历史链接：{duplicateTaskInfo?.source_url || pendingDuplicatePayload?.video_url || '-'}</div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleOpenDuplicateTask} disabled={continuingRemainingDuplicates}>查看上一次笔记</Button>
            {duplicateFlowMode === 'batch' && (
              <Button type="button" variant="outline" onClick={handleSkipAllRemainingDuplicates} disabled={continuingRemainingDuplicates}>本轮剩余全部跳过</Button>
            )}
            <Button type="button" variant="outline" onClick={handleSkipDuplicate} disabled={continuingRemainingDuplicates}>{duplicateFlowMode === 'batch' ? '跳过当前项' : '取消'}</Button>
            {duplicateFlowMode === 'batch' && (
              <Button
                type="button"
                variant="outline"
                onClick={handleContinueAllRemainingDuplicates}
                disabled={continuingRemainingDuplicates}
              >
                {continuingRemainingDuplicates && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {continuingRemainingDuplicates ? '正在批量提交…' : '本轮剩余全部继续'}
              </Button>
            )}
            <Button type="button" onClick={handleConfirmDuplicate} disabled={continuingRemainingDuplicates}>继续生成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {batchDuplicateItems.length > 0 && !duplicateConfirmOpen && (
        <Alert className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/90 shadow-sm">
          <AlertDescription className="space-y-3">
            <div className="font-medium text-neutral-900">检测到重复链接</div>
            <div className="text-sm text-neutral-600">有 {batchDuplicateItems.length} 条批量链接以前生成过笔记，你可以选择跳过、全部继续，或按队列逐条确认。</div>
            <div className="text-xs text-neutral-500">处理完成后会提示本次跳过与继续生成的汇总结果。</div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (!batchDuplicatePayload)
                    return
                  setBatchDuplicateItems([])
                  await submitBatchWithStrategy(batchDuplicatePayload, 'skip')
                }}
              >
                跳过重复
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (!batchDuplicatePayload)
                    return
                  setBatchDuplicateItems([])
                  await submitBatchWithStrategy(batchDuplicatePayload, 'continue_all')
                }}
              >
                全部继续生成
              </Button>
              <Button
                type="button"
                onClick={() => showNextBatchDuplicate(batchDuplicateItems, batchDuplicatePayload)}
              >
                逐条确认
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4">
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-cyan-50 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">创建新笔记</div>
                <p className="mt-1 text-sm text-slate-500">输入视频链接、选择模型与风格，即可生成结构化内容。</p>
              </div>
              {batchCount > 0 && (
                <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200/60">
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  {`批量 ${batchCount} 条`}
                </div>
              )}
            </div>
            <div className="mt-4 border-t border-blue-100/70 pt-4">
              <FormButton />
              <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                {editing
                  ? '将用当前配置重新生成笔记，生成结果会替换现有内容'
                  : batchMode
                    ? '多行链接将以批量任务提交，逐条检测重复后生成'
                    : '单条链接生成一篇结构化笔记，支持多种平台'}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
            <SectionHeader title="项目" tip="将笔记放入已有项目，或新建一个项目" />
            <div className="flex items-center gap-2">
              <Select value={selectedBatchId} onValueChange={(v) => {
                setSelectedBatchId(v)
                if (v !== '__new__') setNewBatchName('')
              }}>
                <SelectTrigger className="h-11 flex-1 rounded-xl border-slate-200 bg-white shadow-sm">
                  <SelectValue placeholder="不选择项目（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new__">＋ 新建项目</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.batch_id} value={p.batch_id}>{p.batch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBatchId && (
                <button
                  type="button"
                  aria-label="清除项目选择"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-sm transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500"
                  onClick={() => { setSelectedBatchId(''); setNewBatchName('') }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {selectedBatchId === '__new__' && (
              <Input
                className="mt-2 h-11 rounded-xl border-slate-200 bg-white shadow-sm"
                placeholder="输入新项目名称"
                value={newBatchName}
                onChange={e => setNewBatchName(e.target.value)}
              />
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
            <SectionHeader title="视频链接" />
            <div className="flex gap-2">
              <FormField
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <FormItem>
                    <Select disabled={!!editing} value={field.value} onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-11 w-40 rounded-xl border-slate-200 bg-white shadow-sm sm:w-48">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {videoPlatforms?.map(p => (
                          <SelectItem key={p.value} value={p.value}>
                            <div className="flex items-center justify-center gap-2">
                              <div className="h-4 w-4">{p.logo()}</div>
                              <span>{p.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage style={{ display: 'none' }} />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="video_url"
              render={({ field }) => (
                <FormItem className="mt-2">
                  <div className="relative">
                    <Input
                      disabled={!!editing && batchCount === 0}
                      placeholder={platform === 'local' ? '请输入本地视频路径，如 /Users/xxx/video.mp4' : '粘贴视频链接，如 https://b23.tv/…'}
                      aria-label="视频链接"
                      className="h-11 rounded-xl border-slate-200 bg-white pr-10 shadow-sm transition-[border-color,box-shadow] focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      {...field}
                    />
                    {field.value?.trim() && (
                      <button
                        type="button"
                        aria-label="清空视频链接"
                        className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-[color,background-color,transform] hover:bg-rose-100 hover:text-rose-500 active:scale-90"
                        onClick={() => field.onChange('')}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <FormMessage style={{ display: 'none' }} />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="video_url"
              render={({ field }) => (
                <FormItem className="flex-1">
                  {platform === 'local' && (
                    <div
                      role="button"
                      tabIndex={isUploading ? -1 : 0}
                      aria-label="上传本地视频：拖拽文件到这里，或按回车键选择文件"
                      aria-disabled={isUploading}
                      className="group mt-3 flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      onDragOver={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onDrop={e => {
                        e.preventDefault()
                        if (isUploading)
                          return
                        const file = e.dataTransfer.files?.[0]
                        if (file)
                          handleFileUpload(file, field.onChange)
                      }}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== ' ')
                          return
                        e.preventDefault()
                        inputRef.current?.click()
                      }}
                      onClick={() => inputRef.current?.click()}
                    >
                      <input
                        ref={inputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file)
                            handleFileUpload(file, field.onChange)
                        }}
                      />
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-blue-500 shadow-sm transition-transform group-hover:scale-110">
                        <Upload className="h-5 w-5" aria-hidden="true" />
                      </div>
                      {isUploading
                        ? <p className="text-center text-sm text-blue-500">上传中，请稍候…</p>
                        : uploadSuccess
                          ? <p className="text-center text-sm font-medium text-green-600">上传成功</p>
                          : (
                              <p className="text-center text-sm text-slate-500">
                                拖拽视频文件到这里上传 <br />
                                <span className="text-xs text-slate-400">或点击 / 按回车选择文件</span>
                              </p>
                            )}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
            {uniqueModels.length > 0
              ? (
                  <FormField
                    className="w-full"
                    control={form.control}
                    name="model_name"
                    render={({ field }) => (
                      <FormItem>
                        <SectionHeader title="模型选择" tip="不同模型效果不同，建议自行测试" />
                        <Select value={field.value} onValueChange={(value) => {
                          field.onChange(value)
                          form.clearErrors('model_name')
                        }} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full min-w-0 truncate aria-[invalid=true]:border-red-500">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {uniqueModels.map(m => (
                              <SelectItem key={`${m.provider_id}-${m.model_name}`} value={m.model_name}>
                                {m.model_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                        {form.formState.errors.model_name && (
                          <p className="text-sm font-medium text-red-500">{form.formState.errors.model_name.message}</p>
                        )}
                      </FormItem>
                    )}
                  />
                )
              : (
                  <FormItem>
                    <SectionHeader title="模型选择" tip="不同模型效果不同，建议自行测试" />
                    <Button type="button" variant="outline" onClick={goModelAdd}>请先添加模型</Button>
                    <FormMessage />
                  </FormItem>
                )}

            <FormField
              className="w-full"
              control={form.control}
              name="style"
              render={({ field }) => (
                <FormItem>
                  <SectionHeader title="笔记风格" tip="选择生成笔记的呈现风格" />
                  <Select value={field.value} onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full min-w-0 truncate">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {noteStyles.map(({ label, value }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
            <SectionHeader title="视频理解" tip="将视频截图发给多模态模型辅助分析" />
            <div className="flex flex-col gap-3">
              <FormField
              control={form.control}
              name="video_understanding"
              render={() => (
                <FormItem>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50/80 to-white px-4 py-3 transition-colors hover:border-blue-200">
                    <div>
                      <FormLabel className="text-sm font-medium text-slate-800">启用视频理解</FormLabel>
                      <p className="mt-1 text-xs text-slate-500">让多模态模型结合截图辅助理解视频内容</p>
                    </div>
                    <Checkbox
                      checked={videoUnderstandingEnabled}
                      onCheckedChange={v => form.setValue('video_understanding', !!v)}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4 rounded-2xl bg-slate-50/80 p-4">
              <FormField
                control={form.control}
                name="video_interval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>采样间隔（秒）</FormLabel>
                    <Input
                      className="h-11 rounded-xl border-slate-200 bg-white shadow-sm"
                      disabled={!videoUnderstandingEnabled}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={30}
                      aria-label="采样间隔（秒）"
                      value={field.value ?? 6}
                      onChange={e => field.onChange(parsePositiveInt(e, 6))}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="grid_size"
                render={({ field }) => {
                  const gridValue = Array.isArray(field.value) ? field.value : [2, 2]
                  const columns = gridValue[0] ?? 2
                  const rows = gridValue[1] ?? 2

                  return (
                    <FormItem>
                      <FormLabel>拼图尺寸（列 × 行）</FormLabel>
                      <div className="flex items-center space-x-2">
                        <Input
                          disabled={!videoUnderstandingEnabled}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={10}
                          aria-label="拼图列数"
                          value={columns}
                          onChange={(e) => {
                            const next = parsePositiveInt(e, columns)
                            field.onChange([next, rows])
                          }}
                          className="h-11 w-16 rounded-xl border-slate-200 bg-white shadow-sm"
                        />
                        <span aria-hidden="true">×</span>
                        <Input
                          disabled={!videoUnderstandingEnabled}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={10}
                          aria-label="拼图行数"
                          value={rows}
                          onChange={(e) => {
                            const next = parsePositiveInt(e, rows)
                            field.onChange([columns, next])
                          }}
                          className="h-11 w-16 rounded-xl border-slate-200 bg-white shadow-sm"
                        />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
            </div>
            <Alert variant="warning" className="rounded-2xl border border-amber-200 bg-amber-50/80 text-sm">
              <AlertDescription>
                <strong>提示：</strong>视频理解功能必须使用多模态模型。
              </AlertDescription>
            </Alert>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
            <FormField
              control={form.control}
              name="format"
              render={({ field }) => (
                <FormItem>
                  <SectionHeader title="笔记格式" tip="选择要包含的笔记元素" />
                  <CheckboxGroup
                    value={field.value}
                    onChange={field.onChange}
                    disabledMap={{
                      link: platform === 'local',
                      screenshot: !videoUnderstandingEnabled,
                    }}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
            <FormField
              control={form.control}
              name="extras"
              render={({ field }) => (
                <FormItem>
                  <SectionHeader title="备注" tip="可在 Prompt 结尾附加自定义说明" />
                  <Textarea className="min-h-28 rounded-2xl border-slate-200 bg-white/90 shadow-sm transition-[border-color,box-shadow] hover:border-blue-200 focus:border-blue-400 focus:ring-4 focus:ring-blue-100" placeholder="笔记需要罗列出 xxx 关键点…" aria-label="备注" {...field} />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </form>
      </Form>
    </div>
  )
}

export default NoteForm
