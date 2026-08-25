import { RefreshCw, Trash } from 'lucide-react'

import { Button } from '@/components/ui/button.tsx'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'
import type { Task } from '@/store/taskStore'

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
}

const statusClassName = (status: string) => {
  if (status === 'SUCCESS')
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  if (status === 'FAILED')
    return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
  if (status === 'CANCELED')
    return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
  if (status === 'PAUSED')
    return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
  return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
}

const TaskHistoryCard = ({ task, selected, onSelect, onDelete, onRetry }: TaskHistoryCardProps) => {
  const baseURL = (String(import.meta.env.VITE_API_BASE_URL || 'api')).replace(/\/$/, '')
  const status = String(task.status || '').toUpperCase()
  const title = task.audioMeta.title || task.sourceUrl || task.formData.video_url || '未命名任务'
  const videoURL = task.formData.video_url || task.sourceUrl || ''
  const platform = task.platform || task.audioMeta.platform || '未知平台'
  const coverURL = task.audioMeta.cover_url || ''
  const isLocal = platform === 'local'
  const coverSrc = !coverURL
    ? '/placeholder.png'
    : isLocal
      ? coverURL
      : `${baseURL}/image_proxy?url=${encodeURIComponent(coverURL)}`
  const isRunning = !['SUCCESS', 'FAILED', 'CANCELED', 'PAUSED'].includes(status)

  return (
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
        'group min-w-0 flex cursor-pointer flex-col rounded-2xl border border-slate-200/80 bg-white/88 p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md',
        selected && 'border-blue-300 bg-blue-50/70 shadow-md ring-2 ring-blue-100',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
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

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="line-clamp-2 flex-1 break-words text-sm font-medium leading-5 text-slate-800">
                    {title}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{title}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="flex shrink-0 items-center gap-1">
              {status === 'FAILED' && onRetry && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation()
                          void onRetry(task.id)
                        }}
                        className="h-8 w-8 shrink-0 rounded-xl text-slate-400 opacity-100 transition hover:bg-slate-100 hover:text-slate-700 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <RefreshCw className="h-4 w-4" />
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
                      onClick={(event) => {
                        event.stopPropagation()
                        onDelete(task.id)
                      }}
                      className="h-8 w-8 shrink-0 rounded-xl text-slate-400 opacity-100 transition hover:text-rose-600 md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>删除</p>
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
          {status === 'FAILED' && task.message?.trim() && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="mt-1 line-clamp-2 cursor-help text-[11px] text-rose-600">
                    失败原因：{task.message.trim()}
                  </p>
                </TooltipTrigger>
                <TooltipContent className="max-w-md whitespace-pre-wrap break-words text-xs leading-5">
                  {task.message.trim()}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <div className="mt-2.5 flex min-w-0 flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-500">
            <div className={cn('inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-1 font-medium', statusClassName(status))}>
              {isRunning && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
              <span className="truncate">{STATUS_LABELS[status] || '处理中'}</span>
            </div>
            <span className="max-w-full truncate text-slate-400">{platform}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TaskHistoryCard
