import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Pause, Play, RefreshCw, Ban, Trash, Pencil, Check, X,
  ChevronLeft, ChevronRight, Layers3,
} from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog.tsx'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import { cn } from '@/lib/utils.ts'

import { useModelStore } from '@/store/modelStore'
import {
  useTaskStore, createHistoryTask, HISTORY_PAGE_SIZE,
  type Task, type BatchControlState,
} from '@/store/taskStore'
import {
  checkBatchDuplicates, generateNotesBatch,
  type DuplicateCheckResult, type GenerateBatchPayload,
} from '@/services/note.ts'
import { getAllBatches } from '@/services/note.ts'
import { noteFormats, noteStyles } from '@/constant/note.ts'

/* ─── 常量 ─── */

interface ProjectItem { batch_id: string; batch_name: string }
type Step = 'form' | 'review'

const STATUS_LABELS: Record<string, string> = {
  PENDING: '等待中', PAUSED: '已暂停', CANCELED: '已取消',
  PARSING: '解析中', DOWNLOADING: '下载中', TRANSCRIBING: '转录中',
  SUMMARIZING: '总结中', FORMATTING: '格式化中', SAVING: '保存中',
  SUCCESS: '已完成', FAILED: '失败',
}

const CONTROL_LABELS: Record<string, string> = {
  RUNNING: '进行中', PAUSED: '已暂停', CANCELED: '已取消', COMPLETED: '已完成',
}

const statusClassName = (status: string) => {
  if (status === 'SUCCESS') return 'bg-emerald-100 text-emerald-700'
  if (status === 'FAILED') return 'bg-red-100 text-red-600'
  if (status === 'CANCELED') return 'bg-slate-100 text-slate-500'
  if (status === 'PAUSED') return 'bg-slate-100 text-slate-500'
  return 'bg-amber-100 text-amber-700'
}

const controlStateClassName = (cs: string) => {
  if (cs === 'RUNNING') return 'bg-blue-100 text-blue-700'
  if (cs === 'PAUSED') return 'bg-amber-100 text-amber-700'
  if (cs === 'CANCELED') return 'bg-slate-100 text-slate-500'
  if (cs === 'COMPLETED') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-500'
}

const resolveControlState = (
  controlState: BatchControlState | null | undefined,
  pending: number,
): BatchControlState => controlState || (pending > 0 ? 'RUNNING' : 'COMPLETED')

/* ─── 组件 ─── */

const BatchTasks = () => {
  /* ── store ── */
  const batchGroups = useTaskStore(s => s.batchGroups)
  const tasks = useTaskStore(s => s.tasks)
  const getBatchItems = useTaskStore(s => s.getBatchItems)
  const addPendingTask = useTaskStore(s => s.addPendingTask)
  const addBatchGroup = useTaskStore(s => s.addBatchGroup)
  const pauseBatchGroup = useTaskStore(s => s.pauseBatchGroup)
  const resumeBatchGroup = useTaskStore(s => s.resumeBatchGroup)
  const cancelBatchGroup = useTaskStore(s => s.cancelBatchGroup)
  const clearFailedBatchTasks = useTaskStore(s => s.clearFailedBatchTasks)
  const retryFailedBatchTasks = useTaskStore(s => s.retryFailedBatchTasks)
  const removeBatchGroup = useTaskStore(s => s.removeBatchGroup)
  const renameBatch = useTaskStore(s => s.renameBatch)
  const removeTask = useTaskStore(s => s.removeTask)
  const retryTask = useTaskStore(s => s.retryTask)

  const modelList = useModelStore(s => s.modelList)
  const loadEnabledModels = useModelStore(s => s.loadEnabledModels)
  const uniqueModels = useMemo(
    () => modelList.filter((m, i, l) => l.findIndex(x => x.model_name === m.model_name) === i),
    [modelList],
  )

  /* ── 创建对话框 state ── */
  const [dialogOpen, setDialogOpen] = useState(false)
  const [step, setStep] = useState<Step>('form')
  const [platform, setPlatform] = useState('bilibili')
  const [batchUrls, setBatchUrls] = useState('')
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [newBatchName, setNewBatchName] = useState('')
  const [modelName, setModelName] = useState('')
  const [style, setStyle] = useState('minimal')
  const [format, setFormat] = useState<string[]>([])
  const [videoUnderstanding, setVideoUnderstanding] = useState(false)
  const [videoInterval, setVideoInterval] = useState(6)
  const [gridSize, setGridSize] = useState<[number, number]>([2, 2])
  const [extras, setExtras] = useState('')
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<DuplicateCheckResult[]>([])
  const [duplicateChoices, setDuplicateChoices] = useState<Record<string, 'confirm' | 'skip'>>({})
  const [submitting, setSubmitting] = useState(false)
  const [projects, setProjects] = useState<ProjectItem[]>([])

  /* ── 左右分栏 state ── */
  const [selectedBatchIdView, setSelectedBatchIdView] = useState<string>('')
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [pendingDeleteBatchId, setPendingDeleteBatchId] = useState<string | null>(null)
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null)
  const [isDeletingBatch, setIsDeletingBatch] = useState(false)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [busyBatchAction, setBusyBatchAction] = useState<string | null>(null)
  const [groupPage, setGroupPage] = useState(1)
  const [taskPage, setTaskPage] = useState(1)

  /* ── derived ── */
  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const urlList = useMemo(() => batchUrls.split('\n').map(l => l.trim()).filter(Boolean), [batchUrls])
  const selectedGroup = batchGroups.find(g => g.id === selectedBatchIdView) || null

  const rightItems = useMemo(() => {
    if (!selectedGroup) return []
    const remoteItems = getBatchItems(selectedGroup.id)
    const visibleTaskIds = new Set(selectedGroup.taskIds)
    if (remoteItems.length > 0) {
      return remoteItems
        .filter(item => visibleTaskIds.has(item.task_id))
        .map(item => taskMap.get(item.task_id) || createHistoryTask(item))
    }
    return selectedGroup.taskIds
      .map(id => taskMap.get(id))
      .filter((t): t is Task => Boolean(t))
  }, [selectedGroup, getBatchItems, taskMap])

  const duplicates = useMemo(() => results.filter(r => r.needs_confirmation && r.duplicate_task), [results])
  const validNew = useMemo(() => results.filter(r => r.valid && !r.needs_confirmation), [results])
  const invalid = useMemo(() => results.filter(r => !r.valid), [results])

  /* pagination */
  const BATCH_GROUP_PAGE_SIZE = 8
  const totalGroupPages = Math.max(1, Math.ceil(batchGroups.length / BATCH_GROUP_PAGE_SIZE))
  const currentGroupPage = Math.min(groupPage, totalGroupPages)
  const paginatedGroups = batchGroups.slice((currentGroupPage - 1) * BATCH_GROUP_PAGE_SIZE, currentGroupPage * BATCH_GROUP_PAGE_SIZE)

  const totalTaskPages = Math.max(1, Math.ceil(rightItems.length / HISTORY_PAGE_SIZE))
  const currentTaskPage = Math.min(taskPage, totalTaskPages)
  const paginatedItems = rightItems.slice((currentTaskPage - 1) * HISTORY_PAGE_SIZE, currentTaskPage * HISTORY_PAGE_SIZE)

  useEffect(() => { setTaskPage(1) }, [selectedBatchIdView])

  // 自动选中：进入页面默认选第一个项目；新建项目后自动选中
  useEffect(() => {
    if (batchGroups.length === 0) {
      setSelectedBatchIdView('')
      return
    }
    if (!selectedBatchIdView || !batchGroups.some(g => g.id === selectedBatchIdView))
      setSelectedBatchIdView(batchGroups[0].id)
  }, [batchGroups, selectedBatchIdView])

  /* ── 创建对话框逻辑 ── */
  const loadProjects = async () => {
    try {
      const list = await getAllBatches() as unknown as ProjectItem[]
      setProjects(Array.isArray(list) ? list : [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (dialogOpen) { loadEnabledModels(); loadProjects() }
  }, [dialogOpen])

  const handleCreateBatch = () => {
    setBatchUrls(''); setSelectedBatchId(''); setNewBatchName('')
    setStep('form'); setResults([]); setDuplicateChoices({})
    setFormat([]); setStyle('minimal')
    setVideoUnderstanding(false); setVideoInterval(6); setGridSize([2, 2]); setExtras('')
    if (uniqueModels.length > 0) setModelName(uniqueModels[0].model_name)
    setDialogOpen(true)
  }

  const handleCheckDuplicates = async () => {
    const urls = urlList
    if (urls.length === 0) { toast.error('请至少输入一个视频链接'); return }
    if (!modelName) { toast.error('请选择模型'); return }
    const model = uniqueModels.find(m => m.model_name === modelName)
    if (!model) { toast.error('所选模型不存在'); return }

    let finalBatchId = selectedBatchId
    let finalBatchName = ''
    if (selectedBatchId === '__new__') {
      const name = newBatchName.trim()
      if (!name) { toast.error('请输入新项目名称'); return }
      finalBatchId = crypto.randomUUID(); finalBatchName = name
    } else if (selectedBatchId) {
      finalBatchName = projects.find(p => p.batch_id === selectedBatchId)?.batch_name || ''
    }

    setChecking(true)
    try {
      const payload: GenerateBatchPayload = {
        video_urls: urls, platform, quality: 'fast' as any,
        model_name: modelName, provider_id: model.provider_id,
        format, style,
        video_understanding: videoUnderstanding,
        video_interval: videoUnderstanding ? videoInterval : 0,
        grid_size: gridSize,
        extras: extras.trim() || undefined,
        ...(finalBatchId ? { batch_id: finalBatchId, batch_name: finalBatchName } : {}),
      }
      const res = await checkBatchDuplicates(payload)
      const ordered = [...res].sort((a, b) => {
        if (!a.valid) return 1; if (!b.valid) return -1
        if (a.needs_confirmation && !b.needs_confirmation) return 1
        if (!a.needs_confirmation && b.needs_confirmation) return -1
        return 0
      })
      setResults(ordered)
      const choices: Record<string, 'confirm' | 'skip'> = {}
      for (const r of ordered) { if (r.needs_confirmation) choices[r.video_url] = 'confirm' }
      setDuplicateChoices(choices); setStep('review')
    } catch (e: any) { toast.error(e?.msg || '检测失败') }
    finally { setChecking(false) }
  }

  const handleSubmit = async () => {
    const model = uniqueModels.find(m => m.model_name === modelName)
    if (!model) return
    let finalBatchId = selectedBatchId, finalBatchName = ''
    if (selectedBatchId === '__new__') { finalBatchId = crypto.randomUUID(); finalBatchName = newBatchName.trim() }
    else if (selectedBatchId) { finalBatchName = projects.find(p => p.batch_id === selectedBatchId)?.batch_name || '' }
    const confirmUrls = duplicates.filter(r => duplicateChoices[r.video_url] === 'confirm').map(r => r.video_url)
    const allSubmitUrls = [...validNew.map(r => r.video_url), ...confirmUrls]
    if (allSubmitUrls.length === 0) { toast('没有需要提交的链接', { icon: '⚠️' }); return }

    setSubmitting(true)
    try {
      const payload: GenerateBatchPayload = {
        video_urls: allSubmitUrls, platform, quality: 'fast' as any,
        model_name: modelName, provider_id: model.provider_id,
        format, style,
        video_understanding: videoUnderstanding,
        video_interval: videoUnderstanding ? videoInterval : 0,
        grid_size: gridSize,
        extras: extras.trim() || undefined,
        duplicate_strategy: 'confirm', duplicate_confirm_urls: confirmUrls,
        ...(finalBatchId ? { batch_id: finalBatchId, batch_name: finalBatchName } : {}),
      }
      const batch = await generateNotesBatch(payload)
      const taskIds: string[] = []
      for (const item of batch.tasks) {
        if (!item.task_id || item.skipped || item.needs_confirmation) continue
        taskIds.push(item.task_id)
        addPendingTask(item.task_id, platform, {
          video_url: item.source_url || item.video_url || '', platform,
          model_name: modelName, provider_id: model.provider_id,
          format, style, quality: 'fast' as any, screenshot: false, link: false,
          video_understanding: videoUnderstanding,
          video_interval: videoUnderstanding ? videoInterval : 0,
          grid_size: gridSize,
          extras: extras.trim() || undefined,
        }, batch.batch_id, item.source_url || item.video_url, batch.batch_name)
      }
      if (taskIds.length > 0) addBatchGroup(batch.batch_id, platform, taskIds, batch.batch_name)
      const skippedCount = batch.tasks.filter(t => t.skipped).length
      if (skippedCount > 0) toast.success(`已跳过 ${skippedCount} 条重复链接`)
      toast.success(`批量任务已提交，共 ${taskIds.length} 条`)
      setDialogOpen(false)
    } catch (e: any) { toast.error(e?.msg || '提交失败') }
    finally { setSubmitting(false) }
  }

  /* ── 批量操作 ── */
  const handlePauseResume = async (group: typeof batchGroups[0]) => {
    const cs = resolveControlState(group.controlState, group.pending)
    setBusyBatchAction(group.id)
    try {
      if (cs === 'PAUSED') await resumeBatchGroup(group.id)
      else await pauseBatchGroup(group.id)
    } finally { setBusyBatchAction(null) }
  }

  const handleRetryFailed = async (batchId: string) => {
    setBusyBatchAction(batchId)
    try { await retryFailedBatchTasks(batchId) }
    finally { setBusyBatchAction(null) }
  }

  const handleClearFailed = async (batchId: string) => {
    setBusyBatchAction(batchId)
    try { await clearFailedBatchTasks(batchId) }
    finally { setBusyBatchAction(null) }
  }

  const handleCancel = async (batchId: string) => {
    setBusyBatchAction(batchId)
    try { await cancelBatchGroup(batchId) }
    finally { setBusyBatchAction(null) }
  }

  const handleRemoveBatch = async (batchId: string) => {
    setIsDeletingBatch(true)
    try { await removeBatchGroup(batchId); setPendingDeleteBatchId(null) }
    finally { setIsDeletingBatch(false) }
  }

  const handleRenameBatch = async (batchId: string) => {
    const name = nameInput.trim()
    if (!name) return
    const ok = await renameBatch(batchId, name)
    if (ok) toast.success('重命名成功')
    setEditingBatchId(null)
  }

  const handleDeleteTask = async (taskId: string) => {
    setIsDeletingTask(true)
    try { await removeTask(taskId); setPendingDeleteTaskId(null) }
    finally { setIsDeletingTask(false) }
  }

  const platformLabels: Record<string, string> = {
    bilibili: '哔哩哔哩', youtube: 'YouTube', douyin: '抖音', kuaishou: '快手', local: '本地',
  }

  /* ══════ render ══════ */
  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">批量任务</h2>
          <p className="text-sm text-slate-500">左侧选择项目，右侧查看视频链接状态与操作</p>
        </div>
        <Button onClick={handleCreateBatch} className="gap-2"><Plus className="h-4 w-4" />新增批量任务</Button>
      </div>

      {/* ────── 左右分栏 ────── */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        {/* ── 左：项目列表 ── */}
        <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Layers3 className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-900">项目（{batchGroups.length}）</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {paginatedGroups.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                暂无项目，点击右上角新增
              </div>
            )}
            {paginatedGroups.map(group => {
              const cs = resolveControlState(group.controlState, group.pending)
              const progress = group.total > 0 ? Math.round(((group.success + group.failed + group.canceled) / group.total) * 100) : 0
              const isBusy = busyBatchAction === group.id
              const isSelected = selectedBatchIdView === group.id

              return (
                <div
                  key={group.id}
                  className={cn(
                    'cursor-pointer rounded-xl border p-3 transition-all',
                    isSelected
                      ? 'border-blue-300 bg-blue-50/80 shadow-md ring-1 ring-blue-100'
                      : 'border-slate-200/60 bg-white hover:border-blue-200 hover:shadow-sm',
                  )}
                  onClick={() => setSelectedBatchIdView(group.id)}
                >
                  {/* 名称 */}
                  <div className="flex items-center justify-between gap-2">
                    {editingBatchId === group.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                          autoFocus value={nameInput}
                          onChange={e => setNameInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && nameInput.trim()) handleRenameBatch(group.id)
                            if (e.key === 'Escape') setEditingBatchId(null)
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-blue-300 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0" onClick={() => handleRenameBatch(group.id)}><Check className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0" onClick={() => setEditingBatchId(null)}><X className="h-3 w-3" /></Button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{group.name}</div>
                    )}
                    <div className="flex shrink-0 items-center gap-0.5" onClick={e => e.stopPropagation()}>
                      <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600" onClick={() => { setEditingBatchId(group.id); setNameInput(group.name) }}><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-rose-600" onClick={() => setPendingDeleteBatchId(group.id)}><Trash className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>

                  {/* 状态 + 完成度 */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', controlStateClassName(cs))}>
                      {CONTROL_LABELS[cs] || cs}
                    </span>
                    <span className="text-[10px] text-slate-500">{progress}%</span>
                  </div>

                  {/* 进度条 */}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>

                  {/* 统计 */}
                  <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                    <span>总 {group.total}</span>
                    <span className="text-emerald-500">成功 {group.success}</span>
                    <span className="text-red-500">失败 {group.failed}</span>
                    <span>暂停 {group.paused}</span>
                    <span>取消 {group.canceled}</span>
                    <span>进行中 {group.pending}</span>
                  </div>

                  {/* 操作按钮 */}
                  <div className="mt-2 flex flex-wrap gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      disabled={isBusy || cs === 'CANCELED' || cs === 'COMPLETED'}
                      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                        cs === 'PAUSED' ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-amber-50 text-amber-600 hover:bg-amber-100',
                        (isBusy || cs === 'CANCELED' || cs === 'COMPLETED') && 'opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => handlePauseResume(group)}
                    >
                      {cs === 'PAUSED' ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                      {cs === 'PAUSED' ? '继续' : '暂停'}
                    </button>
                    <button
                      disabled={isBusy || group.failed === 0}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleRetryFailed(group.id)}
                    ><RefreshCw className="h-3 w-3" />重试</button>
                    <button
                      disabled={isBusy || group.failed === 0}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleClearFailed(group.id)}
                    ><Trash className="h-3 w-3" />清除</button>
                    <button
                      disabled={isBusy || cs === 'CANCELED' || cs === 'COMPLETED'}
                      className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500 transition-colors hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleCancel(group.id)}
                    ><Ban className="h-3 w-3" />取消</button>
                  </div>
                </div>
              )
            })}
          </div>
          {/* 项目分页 */}
          {totalGroupPages > 1 && (
            <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              <span>{currentGroupPage}/{totalGroupPages} 页</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={currentGroupPage <= 1} onClick={() => setGroupPage(p => p - 1)}><ChevronLeft className="h-3 w-3" /></Button>
                <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={currentGroupPage >= totalGroupPages} onClick={() => setGroupPage(p => p + 1)}><ChevronRight className="h-3 w-3" /></Button>
              </div>
            </div>
          )}
        </aside>

        {/* ── 右：视频链接列表 ── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm">
          {selectedGroup ? (
            <>
              {/* 右侧 header */}
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">{selectedGroup.name}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                  <span>共 {rightItems.length} 条视频</span>
                  <span className="text-emerald-500">成功 {selectedGroup.success}</span>
                  <span className="text-red-500">失败 {selectedGroup.failed}</span>
                  <span>进行中 {selectedGroup.pending}</span>
                </div>
              </div>
              {/* 列表 */}
              <div className="flex-1 overflow-y-auto">
                {paginatedItems.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400">暂无视频链接</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {paginatedItems.map(task => {
                      const st = String(task.status || '').toUpperCase()
                      const title = task.audioMeta?.title || task.sourceUrl || task.formData?.video_url || task.id
                      const url = task.formData?.video_url || task.sourceUrl || ''
                      const isRunning = !['SUCCESS', 'FAILED', 'CANCELED', 'PAUSED'].includes(st)

                      return (
                        <div key={task.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50/60">
                          {/* 状态徽章 */}
                          <div className="mt-0.5 shrink-0">
                            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', statusClassName(st))}>
                              {isRunning && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                              {STATUS_LABELS[st] || st}
                            </span>
                          </div>
                          {/* 内容 */}
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-sm text-slate-800">{title}</div>
                            {url && (
                              <a href={url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[11px] text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>
                                {url}
                              </a>
                            )}
                            {st === 'FAILED' && task.message?.trim() && (
                              <p className="mt-1 line-clamp-1 text-[11px] text-red-500">{task.message.trim()}</p>
                            )}
                          </div>
                          {/* 操作 */}
                          <div className="flex shrink-0 items-center gap-1">
                            {st === 'FAILED' && (
                              <button
                                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                                title="重试"
                                onClick={() => retryTask(task.id)}
                              ><RefreshCw className="h-3.5 w-3.5" /></button>
                            )}
                            <button
                              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-rose-600"
                              title="删除"
                              onClick={() => setPendingDeleteTaskId(task.id)}
                            ><Trash className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {/* 右侧分页 */}
              {totalTaskPages > 1 && (
                <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                  <span>第 {currentTaskPage}/{totalTaskPages} 页，共 {rightItems.length} 条</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={currentTaskPage <= 1} onClick={() => setTaskPage(p => p - 1)}>上一页</Button>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={currentTaskPage >= totalTaskPages} onClick={() => setTaskPage(p => p + 1)}>下一页</Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-sm text-slate-400">
              <Layers3 className="mb-2 h-8 w-8 opacity-30" />
              请在左侧选择一个项目
            </div>
          )}
        </main>
      </div>

      {/* ══════ 确认删除项目 Dialog ══════ */}
      <Dialog open={!!pendingDeleteBatchId} onOpenChange={o => { if (!o && !isDeletingBatch) setPendingDeleteBatchId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移出整个项目？</DialogTitle>
            <DialogDescription>移出后项目下的笔记将保留在系统中，但不再属于该项目。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={isDeletingBatch} onClick={() => setPendingDeleteBatchId(null)}>取消</Button>
            <Button variant="destructive" disabled={isDeletingBatch} onClick={() => pendingDeleteBatchId && handleRemoveBatch(pendingDeleteBatchId)}>
              {isDeletingBatch && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认移出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════ 确认删除任务 Dialog ══════ */}
      <Dialog open={!!pendingDeleteTaskId} onOpenChange={o => { if (!o && !isDeletingTask) setPendingDeleteTaskId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这条视频？</DialogTitle>
            <DialogDescription>该操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={isDeletingTask} onClick={() => setPendingDeleteTaskId(null)}>取消</Button>
            <Button variant="destructive" disabled={isDeletingTask} onClick={() => pendingDeleteTaskId && handleDeleteTask(pendingDeleteTaskId)}>
              {isDeletingTask && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════ 新增批量任务对话框 ══════ */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) setDialogOpen(false) }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {step === 'form' ? (
            <>
              <DialogHeader>
                <DialogTitle>新增批量任务</DialogTitle>
                <DialogDescription>输入视频链接并选择项目与模型，系统将自动检测重复链接</DialogDescription>
              </DialogHeader>
              <div className="space-y-5 py-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">项目 <span className="text-rose-500">*</span></label>
                  <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                    <SelectTrigger><SelectValue placeholder="选择已有项目或新建项目" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">＋ 新建项目</SelectItem>
                      {projects.map(p => <SelectItem key={p.batch_id} value={p.batch_id}>{p.batch_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedBatchId === '__new__' && <Input className="mt-2" placeholder="输入新项目名称" value={newBatchName} onChange={e => setNewBatchName(e.target.value)} />}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">平台</label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(platformLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">模型 <span className="text-rose-500">*</span></label>
                  <Select value={modelName} onValueChange={setModelName}>
                    <SelectTrigger><SelectValue placeholder="选择模型" /></SelectTrigger>
                    <SelectContent>
                      {uniqueModels.map(m => <SelectItem key={`${m.provider_id}-${m.model_name}`} value={m.model_name}>{m.model_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">笔记风格</label>
                  <Select value={style} onValueChange={setStyle}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {noteStyles.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">笔记格式</label>
                  <div className="flex flex-wrap gap-2">
                    {noteFormats.map(({ label, value: v }) => (
                      <label key={v} className={cn('inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
                        format.includes(v) ? 'border-blue-200 bg-blue-50 text-blue-700' : 'cursor-pointer border-slate-200 bg-white text-slate-600 hover:border-blue-200',
                      )}>
                        <Checkbox checked={format.includes(v)} onCheckedChange={c => setFormat(c ? [...format, v] : format.filter(x => x !== v))} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">视频理解</label>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">启用视频理解</p>
                      <p className="mt-1 text-xs text-slate-500">让多模态模型结合截图辅助理解视频内容</p>
                    </div>
                    <Checkbox checked={videoUnderstanding} onCheckedChange={v => setVideoUnderstanding(!!v)} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-4 rounded-2xl bg-slate-50/80 p-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">采样间隔（秒）</label>
                      <Input
                        className="h-11 rounded-xl border-slate-200 bg-white shadow-sm"
                        disabled={!videoUnderstanding}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={30}
                        aria-label="采样间隔（秒）"
                        value={videoInterval}
                        onChange={e => {
                          const raw = e.target.value.trim()
                          const n = raw === '' ? 6 : Number.parseInt(raw, 10)
                          setVideoInterval(Number.isFinite(n) && n > 0 ? n : 6)
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">拼图尺寸（列 × 行）</label>
                      <div className="flex items-center space-x-2">
                        <Input
                          disabled={!videoUnderstanding}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={10}
                          aria-label="拼图列数"
                          value={gridSize[0]}
                          onChange={e => {
                            const raw = e.target.value.trim()
                            const n = raw === '' ? gridSize[0] : Number.parseInt(raw, 10)
                            const col = Number.isFinite(n) && n > 0 ? n : gridSize[0]
                            setGridSize([col, gridSize[1]])
                          }}
                          className="h-11 w-16 rounded-xl border-slate-200 bg-white shadow-sm"
                        />
                        <span aria-hidden="true">×</span>
                        <Input
                          disabled={!videoUnderstanding}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={10}
                          aria-label="拼图行数"
                          value={gridSize[1]}
                          onChange={e => {
                            const raw = e.target.value.trim()
                            const n = raw === '' ? gridSize[1] : Number.parseInt(raw, 10)
                            const row = Number.isFinite(n) && n > 0 ? n : gridSize[1]
                            setGridSize([gridSize[0], row])
                          }}
                          className="h-11 w-16 rounded-xl border-slate-200 bg-white shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">备注</label>
                  <Textarea
                    className="min-h-24 rounded-2xl border-slate-200 bg-slate-50/70 shadow-inner"
                    placeholder="可在 Prompt 结尾附加自定义说明，例如：笔记需要罗列出 xxx 关键点…"
                    value={extras}
                    onChange={e => setExtras(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">视频链接 <span className="text-slate-400 text-xs">（每行一个，共 {urlList.length} 条）</span></label>
                  <Textarea className="min-h-[160px] rounded-2xl border-slate-200 bg-slate-50/70 shadow-inner"
                    placeholder={"每行一个视频链接，例如：\nhttps://www.bilibili.com/video/BV..."}
                    value={batchUrls} onChange={e => setBatchUrls(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                <Button onClick={handleCheckDuplicates} disabled={checking || urlList.length === 0 || !modelName} className="gap-2">
                  {checking && <Loader2 className="h-4 w-4 animate-spin" />}{checking ? '检测中…' : '检测重复'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>链接对比结果</DialogTitle>
                <DialogDescription>系统检测到 {validNew.length} 条新链接、{duplicates.length} 条已生成过、{invalid.length} 条无效链接。</DialogDescription>
              </DialogHeader>
              <div className="max-h-[50vh] space-y-3 overflow-y-auto py-2">
                {validNew.length > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />新链接（{validNew.length} 条）</div>
                    <div className="space-y-1">
                      {validNew.map(r => (
                        <div key={r.video_url} className="flex items-center gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs text-slate-700">
                          <span className="flex-1 truncate" title={r.video_url}>{r.video_url}</span>
                          <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">新增</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {duplicates.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700"><AlertTriangle className="h-4 w-4" />已生成过（{duplicates.length} 条）</div>
                    <div className="space-y-1">
                      {duplicates.map(r => {
                        const dup = r.duplicate_task!
                        return (
                          <div key={r.video_url} className="flex items-center gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs">
                            <span className="flex-1 truncate" title={r.video_url}>{r.video_url}</span>
                            <span className="shrink-0 max-w-[140px] truncate text-slate-500">{dup.title || '历史笔记'}</span>
                            <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                              dup.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-600' : dup.status === 'FAILED' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600',
                            )}>{dup.status === 'SUCCESS' ? '已完成' : dup.status === 'FAILED' ? '失败' : dup.status}</span>
                            <div className="flex shrink-0 gap-1">
                              <button type="button" onClick={() => setDuplicateChoices(p => ({ ...p, [r.video_url]: 'confirm' }))}
                                className={cn('rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                                  duplicateChoices[r.video_url] === 'confirm' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-blue-50',
                                )}>继续生成</button>
                              <button type="button" onClick={() => setDuplicateChoices(p => ({ ...p, [r.video_url]: 'skip' }))}
                                className={cn('rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                                  duplicateChoices[r.video_url] === 'skip' ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                                )}>跳过</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {invalid.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-600"><XCircle className="h-4 w-4" />无效链接（{invalid.length} 条）</div>
                    <div className="space-y-1">
                      {invalid.map(r => (
                        <div key={r.video_url} className="flex items-center gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs text-slate-500">
                          <span className="flex-1 truncate">{r.video_url}</span>
                          <span className="shrink-0 text-red-400">{r.msg || '无效链接'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep('form')}>返回修改</Button>
                <Button onClick={handleSubmit} disabled={submitting || (validNew.length === 0 && duplicates.filter(r => duplicateChoices[r.video_url] === 'confirm').length === 0)} className="gap-2">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}确认提交
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default BatchTasks
