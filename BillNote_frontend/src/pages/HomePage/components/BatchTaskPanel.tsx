import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers3,
  Loader2,
  Pencil,
  Check,
  X,
  Trash,
  Plus,
} from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils.ts'
import { createHistoryTask, HISTORY_PAGE_SIZE, useTaskStore, type Task } from '@/store/taskStore'
import TaskHistoryCard from '@/pages/HomePage/components/TaskHistoryCard.tsx'

const BATCH_GROUP_PAGE_SIZE = 5

interface BatchTaskPanelProps {
  selectedId: string | null
  onSelect: (taskId: string) => void
  searchValue?: string
}

const BatchTaskPanel = ({ selectedId, onSelect, searchValue = '' }: BatchTaskPanelProps) => {
  const batchGroups = useTaskStore(state => Array.isArray(state.batchGroups) ? state.batchGroups : [])
  const tasks = useTaskStore(state => state.tasks)
  const retryTask = useTaskStore(state => state.retryTask)
  const getBatchItems = useTaskStore(state => state.getBatchItems)
  const removeBatchGroup = useTaskStore(state => state.removeBatchGroup)
  const removeTask = useTaskStore(state => state.removeTask)
  const renameBatch = useTaskStore(state => state.renameBatch)
  const createEmptyProject = useTaskStore(state => state.createEmptyProject)
  const focusedBatchId = useTaskStore(state => state.focusedBatchId)
  const setFocusedBatch = useTaskStore(state => state.setFocusedBatch)
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [pendingDeleteBatchId, setPendingDeleteBatchId] = useState<string | null>(null)
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null)
  const [isDeletingBatch, setIsDeletingBatch] = useState(false)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [groupPage, setGroupPage] = useState(1)
  const [taskPages, setTaskPages] = useState<Record<string, number>>({})
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [isCreatingProject, setIsCreatingProject] = useState(false)
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

  if (batchGroups.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between text-sm font-semibold text-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <Layers3 className="h-4 w-4" />
            </div>
            <span>项目</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-xl text-xs font-medium"
            onClick={() => { setNewProjectName(''); setIsCreateDialogOpen(true) }}
          >
            <Plus className="h-3.5 w-3.5" />
            新建项目
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 py-10 text-center text-sm text-slate-400">
          <Layers3 className="mb-2 h-8 w-8 text-slate-300" />
          暂无项目
          <Button
            type="button"
            size="sm"
            variant="link"
            className="mt-1 text-xs text-blue-500"
            onClick={() => { setNewProjectName(''); setIsCreateDialogOpen(true) }}
          >
            点击新建
          </Button>
        </div>
      </div>
    )
  }

  if (visibleGroups.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between text-sm font-semibold text-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <Layers3 className="h-4 w-4" />
            </div>
            <span>项目</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-xl text-xs font-medium"
            onClick={() => { setNewProjectName(''); setIsCreateDialogOpen(true) }}
          >
            <Plus className="h-3.5 w-3.5" />
            新建项目
          </Button>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-3 py-6 text-center text-sm text-slate-500">当前搜索下暂无项目</div>
      </div>
    )
  }

  const totalGroupPages = Math.max(1, Math.ceil(visibleGroups.length / BATCH_GROUP_PAGE_SIZE))
  const currentGroupPage = Math.min(groupPage, totalGroupPages)
  const paginatedGroups = visibleGroups.slice((currentGroupPage - 1) * BATCH_GROUP_PAGE_SIZE, currentGroupPage * BATCH_GROUP_PAGE_SIZE)

  return (
    <>
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => { if (!open && !isCreatingProject) setIsCreateDialogOpen(false) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>创建一个空项目分组，之后可把笔记移入其中。</DialogDescription>
          </DialogHeader>
          <input
            type="text"
            autoFocus
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newProjectName.trim() && !isCreatingProject) {
                setIsCreatingProject(true)
                const id = createEmptyProject(newProjectName)
                setFocusedBatch(id)
                setExpandedIds(state => [...state, id])
                setNewProjectName('')
                setIsCreateDialogOpen(false)
                setIsCreatingProject(false)
                toast.success('项目已创建')
              }
            }}
            placeholder="输入项目名称"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-blue-300 focus:ring-3 focus:ring-blue-100"
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isCreatingProject} onClick={() => setIsCreateDialogOpen(false)}>取消</Button>
            <Button
              type="button"
              disabled={!newProjectName.trim() || isCreatingProject}
              onClick={() => {
                if (!newProjectName.trim() || isCreatingProject)
                  return
                setIsCreatingProject(true)
                const id = createEmptyProject(newProjectName)
                setFocusedBatch(id)
                setExpandedIds(state => [...state, id])
                setNewProjectName('')
                setIsCreateDialogOpen(false)
                setIsCreatingProject(false)
                toast.success('项目已创建')
              }}
            >
              <Plus className="h-4 w-4" />
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pendingDeleteTaskId}
        onOpenChange={(open) => {
          if (!open && !isDeletingTask)
            setPendingDeleteTaskId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这条笔记？</DialogTitle>
            <DialogDescription>
              {pendingDeleteTaskLabel
                ? `将删除《${pendingDeleteTaskLabel}》，该操作不可撤销。`
                : '将删除这条笔记，该操作不可撤销。'}
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
            <DialogTitle>移出整个项目？</DialogTitle>
            <DialogDescription>
              {pendingDeleteBatch
                ? `将把项目 ${pendingDeleteBatch.name} 下的 ${pendingDeleteBatch.total} 条笔记移出项目视图，但会保留已生成的笔记内容。`
                : '将把该项目下的全部笔记移出项目视图，但会保留已生成的笔记内容。'}
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between text-sm font-semibold text-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <Layers3 className="h-4 w-4" />
            </div>
            <span>项目</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-xl text-xs font-medium"
            onClick={() => { setNewProjectName(''); setIsCreateDialogOpen(true) }}
          >
            <Plus className="h-3.5 w-3.5" />
            新建项目
          </Button>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
        {paginatedGroups.map(group => {
          const isExpanded = expandedIds.includes(group.id)
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
              return task.status === 'FAILED' || task.status === 'RETRYABLE'
            return true
          })
          const groupLabel = group.name
          const totalTaskPages = Math.max(1, Math.ceil(visibleItems.length / HISTORY_PAGE_SIZE))
          const currentTaskPage = Math.min(taskPages[group.id] || 1, totalTaskPages)
          const paginatedItems = visibleItems.slice((currentTaskPage - 1) * HISTORY_PAGE_SIZE, currentTaskPage * HISTORY_PAGE_SIZE)

          return (
            <div
              key={group.id}
              ref={(node) => {
                cardRefs.current[group.id] = node
              }}
              className={cn(
                'shrink-0 min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/92 p-3.5 shadow-sm transition-all',
                focusedBatchId === group.id
                  ? 'border-blue-300 bg-blue-50/80 shadow-md ring-2 ring-blue-100'
                  : 'hover:-translate-y-px hover:border-blue-200 hover:shadow-md',
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
                        {editingName && editingBatchId === group.id ? (
                          <div className="flex min-w-0 flex-1 items-center gap-1">
                            <input
                              type="text"
                              value={nameInput}
                              onChange={e => setNameInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && nameInput.trim()) {
                                  void renameBatch(group.id, nameInput.trim()).then(ok => {
                                    if (ok) toast.success('重命名成功')
                                    setEditingName(false)
                                    setEditingBatchId(null)
                                  })
                                }
                                if (e.key === 'Escape') {
                                  setEditingName(false)
                                  setEditingBatchId(null)
                                }
                              }}
                              autoFocus
                              className="min-w-0 flex-1 rounded-lg border border-blue-300 bg-white px-2 py-1 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 shrink-0 rounded-lg bg-emerald-50 text-emerald-600 shadow-sm hover:bg-emerald-100"
                              disabled={!nameInput.trim()}
                              onClick={() => {
                                if (!nameInput.trim()) return
                                void renameBatch(group.id, nameInput.trim()).then(ok => {
                                  if (ok) toast.success('重命名成功')
                                  setEditingName(false)
                                  setEditingBatchId(null)
                                })
                              }}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 shrink-0 rounded-lg bg-slate-100 text-slate-500 shadow-sm hover:bg-slate-200"
                              onClick={() => {
                                setEditingName(false)
                                setEditingBatchId(null)
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="line-clamp-2 break-all text-sm leading-5 text-slate-900">
                            {groupLabel}
                          </div>
                        )}
                        <div className="flex shrink-0 items-center gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 shrink-0 rounded-lg bg-white text-slate-500 shadow-sm hover:text-blue-600"
                                  disabled={editingName}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setEditingName(true)
                                    setEditingBatchId(group.id)
                                    setNameInput(group.name)
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>重命名项目</p>
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
                              <p>移出项目视图</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col space-y-3.5 overflow-hidden border-t border-slate-100 pt-3.5">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-white/70 p-2 pb-3">
                    <div className="flex shrink-0 items-center justify-between px-1 text-[11px] font-medium text-slate-500">
                      <span>全部笔记</span>
                      <span className="text-[10px] text-slate-400">共 {visibleItems.length} 条</span>
                    </div>
                    {visibleItems.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center text-sm text-slate-500">
                        当前筛选下暂无笔记
                      </div>
                    )}

                    <div className="min-h-0 max-h-[30rem] flex-1 space-y-2.5 overflow-y-auto pr-1">
                    {paginatedItems.map(task => (
                      <TaskHistoryCard
                        key={task.id}
                        task={task}
                        selected={selectedId === task.id}
                        onSelect={onSelect}
                        onDelete={setPendingDeleteTaskId}
                        onRetry={['FAILED', 'RETRYABLE'].includes(task.status) ? retryTask : undefined}
                      />
                    ))}
                    </div>

                    {visibleItems.length > 0 && (
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white/90 px-3 py-2 text-xs text-slate-500 shadow-sm">
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
        </div>
        </div>

        {visibleGroups.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white/90 px-3 py-2 text-xs text-slate-500 shadow-sm">
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
