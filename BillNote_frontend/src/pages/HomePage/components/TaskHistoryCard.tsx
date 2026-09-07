import { RefreshCw, Trash, FolderInput } from 'lucide-react'
import toast from 'react-hot-toast'

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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'
import type { Task } from '@/store/taskStore'
import { useTaskStore } from '@/store/taskStore'
import { useSystemStore } from '@/store/configStore'
import { useState } from 'react'

interface TaskHistoryCardProps {
  task: Task
  selected: boolean
  onSelect: (taskId: string) => void
  onDelete: (taskId: string) => void
  onRetry?: (taskId: string) => void | Promise<void>
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: '等待中',
  PAUSED: '已暂停',
  CANCELED: '已取消',
  PARSING: '解析中',
  DOWNLOADING: '下载中',
  TRANSCRIBING: '转录中',
  SUMMARIZING: '总结中',
  FORMATTING: '格式化中',
  SAVING: '保存中',
  SUCCESS: '已完成',
  FAILED: '失败',
  RETRYABLE: '可重试',
}

const statusClassName = (status: string) => {
  if (status === 'SUCCESS')
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'FAILED')
    return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  if (status === 'RETRYABLE')
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  if (status === 'CANCELED')
    return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
  if (status === 'PAUSED')
    return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
  return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
}

const TaskHistoryCard = ({ task, selected, onSelect, onDelete, onRetry }: TaskHistoryCardProps) => {
  const showCover = useSystemStore(state => state.showNoteCover)
  const fetchAllBatches = useTaskStore(state => state.fetchAllBatches)
  const moveTaskToProject = useTaskStore(state => state.moveTaskToProject)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [projectList, setProjectList] = useState<Array<{ batch_id: string, batch_name: string }>>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [isMoving, setIsMoving] = useState(false)
  const baseURL = (String(import.meta.env.VITE_API_BASE_URL || 'api')).replace(/\/$/, '')
  const status = String(task.status || '').toUpperCase()
  const title = task.audioMeta.title || task.sourceUrl || task.formData.video_url || '未命名笔记'
  const videoURL = task.formData.video_url || task.sourceUrl || ''
  const platform = task.platform || task.audioMeta.platform || '未知平台'
  const coverURL = task.audioMeta.cover_url || ''
  const isLocal = platform === 'local'
  const coverSrc = !coverURL
    ? '/placeholder.png'
    : isLocal
      ? coverURL
      : `${baseURL}/image_proxy?url=${encodeURIComponent(coverURL)}`
  const isTerminal = ['SUCCESS', 'FAILED', 'CANCELED', 'PAUSED', 'RETRYABLE'].includes(status)
  const isRunning = !isTerminal

  const handleOpenProjectDialog = async () => {
    setSelectedProjectId('')
    setLoadingProjects(true)
    setProjectDialogOpen(true)
    try {
      const list = await fetchAllBatches()
      setProjectList(list || [])
    } catch {
      setProjectList([])
    } finally {
      setLoadingProjects(false)
    }
  }

  const handleConfirmMove = async () => {
    const target = projectList.find(p => p.batch_id === selectedProjectId)
    if (!target) return
    setIsMoving(true)
    try {
      const ok = await moveTaskToProject(task.id, target.batch_id, target.batch_name)
      if (ok) toast.success(`已移入项目「${target.batch_name}」`)
      else toast.error('移入项目失败')
    } finally {
      setIsMoving(false)
      setProjectDialogOpen(false)
    }
  }

  const handleRemoveFromProject = async () => {
    setProjectDialogOpen(false)
    const ok = await moveTaskToProject(task.id, '', '')
    if (ok) toast.success('已移出项目')
    else toast.error('移出项目失败')
  }

  return (
    <>
      <Dialog
        open={projectDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isMoving) setProjectDialogOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>移入项目</DialogTitle>
            <DialogDescription>
              将笔记「{title.length > 30 ? `${title.slice(0, 30)}…` : title}」移入以下项目
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto py-2">
            {task.batchId && (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-left text-sm text-rose-600 transition-colors hover:bg-rose-50"
                onClick={() => void handleRemoveFromProject()}
              >
                <span className="shrink-0">✕</span>
                <span>移出当前项目（{task.batchName || '未命名'}）</span>
              </button>
            )}
            {loadingProjects
              ? (
                <div className="px-4 py-6 text-center text-sm text-slate-400">加载项目中…</div>
              )
              : projectList.filter(p => p.batch_id !== task.batchId).length === 0
                ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-400">暂无其他项目</div>
                )
                : (
                  projectList.filter(p => p.batch_id !== task.batchId).map(p => (
                    <label
                      key={p.batch_id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                        selectedProjectId === p.batch_id
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50',
                      )}
                    >
                      <input
                        type="radio"
                        name="move-project"
                        className="h-4 w-4 accent-blue-600"
                        checked={selectedProjectId === p.batch_id}
                        onChange={() => setSelectedProjectId(p.batch_id)}
                      />
                      <span className="text-sm">{p.batch_name}</span>
                    </label>
                  ))
                )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isMoving} onClick={() => setProjectDialogOpen(false)}>取消</Button>
            <Button
              type="button"
              disabled={isMoving || !selectedProjectId}
              onClick={() => void handleConfirmMove()}
            >
              {isMoving && <span className="mr-2 h-4 w-4 animate-spin inline-block rounded-full border-2 border-current border-t-transparent" />}
              {isMoving ? '移入中…' : '确认移入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(task.id)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ')
            return
          event.preventDefault()
          onSelect(task.id)
        }}
        className={cn(
          'group min-w-0 flex cursor-pointer flex-col rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm transition-[border-color,background-color] hover:border-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          selected && 'border-blue-300 bg-blue-50/70 shadow-md ring-2 ring-blue-100',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {showCover && (
            <img
              data-fallback={coverSrc === '/placeholder.png' ? 'true' : undefined}
              src={coverSrc}
              alt="封面"
              loading="lazy"
              className="h-12 w-14 shrink-0 rounded-xl bg-slate-100 object-cover shadow-sm"
              onError={(event) => {
                if (event.currentTarget.dataset.fallback === 'true')
                  return
                event.currentTarget.dataset.fallback = 'true'
                event.currentTarget.src = '/placeholder.png'
              }}
            />
          )}

          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <div className="line-clamp-2 flex-1 break-words text-sm font-medium leading-5 text-slate-800">
                {title}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {(status === 'FAILED' || status === 'RETRYABLE') && onRetry && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label="重试该笔记"
                          onClick={(event) => {
                            event.stopPropagation()
                            void onRetry(task.id)
                          }}
                          className="h-8 w-8 shrink-0 rounded-xl text-slate-400 opacity-100 transition-[color,background-color] hover:bg-slate-100 hover:text-slate-700 md:opacity-0 md:group-hover:opacity-100"
                        >
                          <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>重试</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="删除该笔记"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDelete(task.id)
                        }}
                        className="h-8 w-8 shrink-0 rounded-xl text-slate-400 opacity-100 transition-[color,background-color] hover:bg-slate-100 hover:text-rose-600 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <Trash className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>删除</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="移入项目"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleOpenProjectDialog()
                        }}
                        className="h-8 w-8 shrink-0 rounded-xl text-slate-400 opacity-100 transition-[color,background-color] hover:bg-slate-100 hover:text-blue-600 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <FolderInput className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>移入项目</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {videoURL && (
              <a
                href={videoURL}
                target="_blank"
                rel="noreferrer"
                title={videoURL}
                className="mt-1 block truncate text-[11px] text-blue-600 underline-offset-2 hover:underline"
                onClick={event => event.stopPropagation()}
              >
                {videoURL}
              </a>
            )}
            {(status === 'FAILED' || status === 'RETRYABLE') && task.message?.trim() && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className={cn(
                      'mt-1 line-clamp-2 cursor-help text-[11px]',
                      status === 'RETRYABLE' ? 'text-amber-600' : 'text-rose-600',
                    )}
                    >
                      {status === 'RETRYABLE' ? '中断原因：' : '失败原因：'}{task.message.trim()}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-md whitespace-pre-wrap break-words text-xs leading-5">
                    {task.message.trim()}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-500">
              <div className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 font-medium tabular-nums', statusClassName(status))}>
                {isRunning && <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                </span>}
                <span className="truncate">{STATUS_LABELS[status] || '处理中'}</span>
              </div>
              <span className="max-w-full truncate text-slate-400">{platform}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default TaskHistoryCard
