import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers3,
  Loader2,
  Pause,
  RefreshCw,
  Trash,
} from 'lucide-react'

import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils.ts'
import { createHistoryTask, HISTORY_PAGE_SIZE, useTaskStore, type BatchControlState, type Task } from '@/store/taskStore'
import TaskHistoryCard from '@/pages/HomePage/components/TaskHistoryCard.tsx'

const FILTERS = [
  { key: 'all', label: '全部', shortLabel: '全' },
  { key: 'success', label: '成功', shortLabel: '成' },
  { key: 'failed', label: '失败', shortLabel: '失' },
] as const

const BATCH_GROUP_PAGE_SIZE = 5

interface BatchTaskPanelProps {
  selectedId: string | null
  onSelect: (taskId: string) => void
  searchValue?: string
}

const getDisplayControlState = (state: BatchControlState | null | undefined, pending: number): BatchControlState => {
  if (state)
    return state
  return pending > 0 ? 'RUNNING' : 'COMPLETED'
}

const getControlStateLabel = (state: BatchControlState) => {
  if (state === 'PAUSED')
    return '已暂停'
  if (state === 'CANCELED')
    return '已取消'
  if (state === 'COMPLETED')
    return '已完成'
  return '进行中'
}

const BatchTaskPanel = ({ selectedId, onSelect, searchValue = '' }: BatchTaskPanelProps) => {
  const batchGroups = useTaskStore(state => state.batchGroups)
  const tasks = useTaskStore(state => state.tasks)
  const retryTask = useTaskStore(state => state.retryTask)
  const getBatchItems = useTaskStore(state => state.getBatchItems)
  const setBatchFilter = useTaskStore(state => state.setBatchFilter)
  const retryFailedBatchTasks = useTaskStore(state => state.retryFailedBatchTasks)
  const clearFailedBatchTasks = useTaskStore(state => state.clearFailedBatchTasks)
  const pauseBatchGroup = useTaskStore(state => state.pauseBatchGroup)
  const resumeBatchGroup = useTaskStore(state => state.resumeBatchGroup)
  const cancelBatchGroup = useTaskStore(state => state.cancelBatchGroup)
  const removeBatchGroup = useTaskStore(state => state.removeBatchGroup)
  const removeTask = useTaskStore(state => state.removeTask)
  const focusedBatchId = useTaskStore(state => state.focusedBatchId)
  const setFocusedBatch = useTaskStore(state => state.setFocusedBatch)
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [pendingDeleteBatchId, setPendingDeleteBatchId] = useState<string | null>(null)
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null)
  const [isDeletingBatch, setIsDeletingBatch] = useState(false)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [busyBatchAction, setBusyBatchAction] = useState<string | null>(null)
  const [groupPage, setGroupPage] = useState(1)
  const [taskPages, setTaskPages] = useState<Record<string, number>>({})
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const normalizedSearch = searchValue.trim().toLocaleLowerCase()
  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const getFallbackTaskTitle = (taskId: string) => {
    for (const group of batchGroups) {
      const item = getBatchItems(group.id).find(entry => entry.task_id === taskId)
      if (item)
        return item.title || item.source_url || item.video_id || taskId
    }
    return taskId
  }
  const visibleGroups = useMemo(() => {
    if (!normalizedSearch)
      return batchGroups

    return batchGroups
      .map(group => {
        const groupMatches = group.name.toLocaleLowerCase().includes(normalizedSearch)
        const matchingTaskIds = groupMatches
          ? group.taskIds
          : group.taskIds.filter(taskId => {
              const task = taskMap.get(taskId)
              if (!task)
                return false
              const title = task.audioMeta.title || ''
              const videoUrl = task.formData.video_url || ''
              return `${title} ${videoUrl}`.toLocaleLowerCase().includes(normalizedSearch)
            })
        return matchingTaskIds.length > 0
          ? { ...group, taskIds: matchingTaskIds }
          : null
      })
      .filter((group): group is (typeof batchGroups)[number] => group !== null)
  }, [batchGroups, normalizedSearch, taskMap])

  useEffect(() => {
    const totalGroupPages = Math.max(1, Math.ceil(visibleGroups.length / BATCH_GROUP_PAGE_SIZE))
    setGroupPage(page => Math.min(page, totalGroupPages))
    setTaskPages(state => {
      const next: Record<string, number> = {}
      for (const group of visibleGroups)
        next[group.id] = state[group.id] || 1
      return next
    })
  }, [visibleGroups])

  useEffect(() => {
    if (!focusedBatchId)
      return
    const node = cardRefs.current[focusedBatchId]
    if (!node)
      return
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedBatchId])

  const pendingDeleteBatch = pendingDeleteBatchId
    ? batchGroups.find(group => group.id === pendingDeleteBatchId) || null
    : null
  const pendingDeleteTask = pendingDeleteTaskId
    ? tasks.find(task => task.id === pendingDeleteTaskId) || null
    : null
  const pendingDeleteTaskLabel = pendingDeleteTaskId
    ? (pendingDeleteTask?.audioMeta.title || pendingDeleteTask?.formData.video_url || getFallbackTaskTitle(pendingDeleteTaskId))
    : null

  if (batchGroups.length === 0)
    return null

  if (visibleGroups.length === 0)
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-3 py-6 text-center text-sm text-slate-500">当前搜索下暂无批量任务</div>

  const totalGroupPages = Math.max(1, Math.ceil(visibleGroups.length / BATCH_GROUP_PAGE_SIZE))
  const currentGroupPage = Math.min(groupPage, totalGroupPages)
  const paginatedGroups = visibleGroups.slice((currentGroupPage - 1) * BATCH_GROUP_PAGE_SIZE, currentGroupPage * BATCH_GROUP_PAGE_SIZE)

  return (
    <>
      <Dialog
        open={!!pendingDeleteTaskId}
        onOpenChange={(open) => {
          if (!open && !isDeletingTask)
            setPendingDeleteTaskId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这条批次任务？</DialogTitle>
            <DialogDescription>
              {pendingDeleteTaskLabel
                ? `将删除《${pendingDeleteTaskLabel}》，该操作不可撤销。`
                : '将删除这条批次任务，该操作不可撤销。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeletingTask} onClick={() => setPendingDeleteTaskId(null)}>取消</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeletingTask}
              onClick={async () => {
                if (!pendingDeleteTaskId || isDeletingTask)
                  return
                setIsDeletingTask(true)
                try {
                  await removeTask(pendingDeleteTaskId)
                  setPendingDeleteTaskId(null)
                } finally {
                  setIsDeletingTask(false)
                }
              }}
            >
              {isDeletingTask ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pendingDeleteBatchId}
        onOpenChange={(open) => {
          if (!open && !isDeletingBatch)
            setPendingDeleteBatchId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移出整个批次？</DialogTitle>
            <DialogDescription>
              {pendingDeleteBatch
                ? `将把批次 ${pendingDeleteBatch.name} 下的 ${pendingDeleteBatch.total} 条任务移出批次视图，但会保留已生成的笔记内容。`
                : '将把该批次下的全部任务移出批次视图，但会保留已生成的笔记内容。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeletingBatch} onClick={() => setPendingDeleteBatchId(null)}>取消</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeletingBatch}
              onClick={async () => {
                if (isDeletingBatch || !pendingDeleteBatchId)
                  return
                setIsDeletingBatch(true)
                try {
                  await removeBatchGroup(pendingDeleteBatchId)
                  setPendingDeleteBatchId(null)
                } catch (error) {
                  console.error('删除批次失败：', error)
                } finally {
                  setIsDeletingBatch(false)
                }
              }}
            >
              {isDeletingBatch && <Loader2 className="h-4 w-4 animate-spin" />}
              {isDeletingBatch ? '移出中…' : '确认移出'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="min-w-0 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Layers3 className="h-4 w-4" />
          </div>
          <span>批量任务</span>
        </div>

        {paginatedGroups.map(group => {
          const isExpanded = expandedIds.includes(group.id)
          const progress = group.total > 0
            ? Math.round(((group.success + group.failed + group.canceled) / group.total) * 100)
            : 0
          const remoteItems = getBatchItems(group.id)
          const visibleTaskIds = new Set(group.taskIds)
          const items = (remoteItems.length > 0
            ? remoteItems
                .filter(item => visibleTaskIds.has(item.task_id))
                .map(item => taskMap.get(item.task_id) || createHistoryTask(item))
            : group.taskIds
                .map(taskId => taskMap.get(taskId))
                .filter((task): task is Task => Boolean(task)))
          const filter = group.filter || 'all'
          const normalizedItems = items.map(task => ({
            ...task,
            status: String(task.status || '').toUpperCase() as Task['status'],
          }))
          const visibleItems = normalizedItems.filter((task) => {
            if (filter === 'success')
              return task.status === 'SUCCESS'
            if (filter === 'failed')
              return task.status === 'FAILED'
            return true
          })
          const isBusy = busyBatchAction === group.id
          const groupLabel = `批次 ${group.name}`
          const totalTaskPages = Math.max(1, Math.ceil(visibleItems.length / HISTORY_PAGE_SIZE))
          const currentTaskPage = Math.min(taskPages[group.id] || 1, totalTaskPages)
          const paginatedItems = visibleItems.slice((currentTaskPage - 1) * HISTORY_PAGE_SIZE, currentTaskPage * HISTORY_PAGE_SIZE)
          const groupSummary = [
            `总数 ${group.total}`,
            `成功 ${group.success}`,
            `失败 ${group.failed}`,
            `暂停 ${group.paused}`,
            `取消 ${group.canceled}`,
            `进行中 ${group.pending}`,
          ]
          const displayControlState = getDisplayControlState(group.controlState, group.pending)

          return (
            <div
              key={group.id}
              ref={(node) => {
                cardRefs.current[group.id] = node
              }}
              className={cn(
                'min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm transition-all',
                focusedBatchId === group.id
                  ? 'border-blue-300 bg-blue-50/80 shadow-md ring-2 ring-blue-100'
                  : 'hover:border-blue-200 hover:shadow-md',
              )}
            >
              <div
                className="flex w-full items-start justify-between gap-3 text-left"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setFocusedBatch(group.id)
                  setExpandedIds(state => state.includes(group.id)
                    ? state.filter(id => id !== group.id)
                    : [...state, group.id])
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ')
                    return
                  event.preventDefault()
                  setFocusedBatch(group.id)
                  setExpandedIds(state => state.includes(group.id)
                    ? state.filter(id => id !== group.id)
                    : [...state, group.id])
                }}
              >
                <div className="min-w-0 flex-1 overflow-hidden rounded-2xl bg-slate-50/70 p-2.5">
                  <div className="flex min-w-0 items-start gap-2 text-sm font-semibold text-slate-900">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="line-clamp-2 break-all text-sm leading-5 text-slate-900">
                          {groupLabel}
                        </div>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 shrink-0 rounded-lg bg-white text-slate-500 shadow-sm hover:text-rose-600"
                                disabled={isDeletingBatch}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  if (isDeletingBatch)
                                    return
                                  setPendingDeleteBatchId(group.id)
                                }}
                              >
                                <Trash className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>移出批次视图</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-500">
                          {getControlStateLabel(displayControlState)}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500">完成度 {progress}%</span>
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <>
                      <div className="mt-3 flex items-center justify-between px-1 text-[11px] font-medium text-slate-500">
                        <span>状态概览</span>
                        <span className="text-[10px] text-slate-400">点击卡片可折叠</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-white/70 p-2 sm:grid-cols-3">
                        {groupSummary.map(item => (
                          <div key={item} className="rounded-lg bg-white px-2 py-1.5 text-center text-[10px] font-medium text-slate-600 shadow-sm">
                            {item}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 min-w-0 space-y-3.5 border-t border-slate-100 pt-3.5">
                  <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-slate-50/65 p-2.5 sm:p-3">
                    <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-500">
                      <span>筛选</span>
                      <span className="text-[10px] text-slate-400">批次结果</span>
                    </div>
                    <div className="px-1 text-[10px] text-slate-400">当前筛选：{filter}</div>
                    <div className={cn('min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]', 'grid grid-cols-3 gap-1')}>
                      {FILTERS.map(option => (
                        <Button
                          key={option.key}
                          type="button"
                          size="sm"
                          variant={filter === option.key ? 'default' : 'outline'}
                          className={cn(
                            'h-8 w-full min-w-0 rounded-lg border border-transparent px-2 text-xs transition-all duration-150',
                            filter === option.key
                              ? 'border-primary/30 bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-[0_6px_14px_rgba(59,130,246,0.28)]'
                              : 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                          )}
                          onClick={(event) => {
                            event.stopPropagation()
                            setBatchFilter(group.id, option.key)
                            setTaskPages(state => ({ ...state, [group.id]: 1 }))
                          }}
                        >
                          <span className="truncate">{option.label}</span>
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-500">
                      <span>操作</span>
                      <span className="text-[10px] text-slate-400">批次工具栏</span>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white/95 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                      <div className="grid min-w-[280px] grid-cols-4 gap-px rounded-lg bg-slate-200/80">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                        className="h-8 min-w-0 w-full max-w-full rounded-none border-0 px-1.5 text-[11px] shadow-none transition-colors bg-white hover:bg-slate-50 first:rounded-l-lg last:rounded-r-lg justify-center"
                        disabled={isBusy || displayControlState === 'CANCELED' || displayControlState === 'COMPLETED'}
                        onClick={async () => {
                          setBusyBatchAction(group.id)
                          try {
                            if (displayControlState === 'PAUSED')
                              await resumeBatchGroup(group.id)
                            else
                              await pauseBatchGroup(group.id)
                          } finally {
                            setBusyBatchAction(null)
                          }
                        }}
                      >
                        <Pause className="mr-1 h-3.5 w-3.5" />
                        {displayControlState === 'PAUSED' ? '继续' : '暂停'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 min-w-0 w-full max-w-full rounded-none border-0 px-1.5 text-[11px] shadow-none transition-colors bg-white hover:bg-slate-50 first:rounded-l-lg last:rounded-r-lg justify-center"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyBatchAction(group.id)
                          try {
                            await retryFailedBatchTasks(group.id)
                          } finally {
                            setBusyBatchAction(null)
                          }
                        }}
                      >
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                        重试失败项
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 min-w-0 w-full max-w-full rounded-none border-0 px-1.5 text-[11px] text-rose-600 shadow-none transition-colors bg-white hover:bg-rose-50/70 hover:text-rose-700 first:rounded-l-lg last:rounded-r-lg justify-center"
                        disabled={isBusy || group.failed === 0}
                        onClick={async () => {
                          setBusyBatchAction(group.id)
                          try {
                            await clearFailedBatchTasks(group.id)
                          } finally {
                            setBusyBatchAction(null)
                          }
                        }}
                      >
                        <Trash className="mr-1 h-3.5 w-3.5" />
                        清除
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 min-w-0 w-full max-w-full rounded-none border-0 px-1.5 text-[11px] shadow-none transition-colors bg-white hover:bg-slate-50 first:rounded-l-lg last:rounded-r-lg justify-center"
                        disabled={isBusy || displayControlState === 'CANCELED' || displayControlState === 'COMPLETED'}
                        onClick={async () => {
                          setBusyBatchAction(group.id)
                          try {
                            await cancelBatchGroup(group.id)
                          } finally {
                            setBusyBatchAction(null)
                          }
                        }}
                      >
                        <Ban className="mr-1 h-3.5 w-3.5" />
                        取消
                      </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-2xl bg-white/70 p-2 pb-3">
                    <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-500">
                      <span>全部子任务</span>
                      <span className="text-[10px] text-slate-400">共 {visibleItems.length} 条</span>
                    </div>
                    {visibleItems.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center text-sm text-slate-500">
                        当前筛选下暂无任务
                      </div>
                    )}

                    {paginatedItems.map(task => (
                      <TaskHistoryCard
                        key={task.id}
                        task={task}
                        selected={selectedId === task.id}
                        onSelect={onSelect}
                        onDelete={setPendingDeleteTaskId}
                        onRetry={task.status === 'FAILED' ? retryTask : undefined}
                      />
                    ))}

                    {visibleItems.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white/90 px-3 py-2 text-xs text-slate-500 shadow-sm">
                        <span>
                          第 {currentTaskPage} / {totalTaskPages} 页
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-2.5"
                            disabled={currentTaskPage <= 1}
                            onClick={() => setTaskPages(state => ({ ...state, [group.id]: Math.max(1, currentTaskPage - 1) }))}
                          >
                            <ChevronLeft className="h-4 w-4" />
                            上一页
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-2.5"
                            disabled={currentTaskPage >= totalTaskPages}
                            onClick={() => setTaskPages(state => ({ ...state, [group.id]: Math.min(totalTaskPages, currentTaskPage + 1) }))}
                          >
                            下一页
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {visibleGroups.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white/90 px-3 py-2 text-xs text-slate-500 shadow-sm">
            <span>
              第 {currentGroupPage} / {totalGroupPages} 页
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg px-2.5"
                disabled={currentGroupPage <= 1}
                onClick={() => setGroupPage(page => Math.max(1, page - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                上一页
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg px-2.5"
                disabled={currentGroupPage >= totalGroupPages}
                onClick={() => setGroupPage(page => Math.min(totalGroupPages, page + 1))}
              >
                下一页
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default BatchTaskPanel
