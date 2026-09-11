import { useTaskStore } from '@/store/taskStore'
import { useProviderStore } from '@/store/providerStore'
import { getHistory } from '@/services/note'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import ModelRerouteDialog from '@/components/ModelRerouteDialog'
import { Button } from '@/components/ui/button.tsx'
import Fuse from 'fuse.js'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import TaskHistoryCard from '@/pages/HomePage/components/TaskHistoryCard.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { HISTORY_PAGE_SIZE } from '@/store/taskStore'

interface NoteHistoryProps {
  onSelect: (taskId: string) => void
  selectedId: string | null
  hideSearch?: boolean
  searchValue?: string
}

const NoteHistory: FC<NoteHistoryProps> = ({
  onSelect,
  selectedId,
  hideSearch = false,
  searchValue,
}) => {
  const allTasks = useTaskStore(state => state.tasks)
  const tasks = useMemo(() => allTasks.filter(task => !task.batchId), [allTasks])
  const removeTask = useTaskStore(state => state.removeTask)
  const retryTask = useTaskStore(state => state.retryTask)
  const historyHasMore = useTaskStore(state => state.historyHasMore)
  const loadMoreHistory = useTaskStore(state => state.loadMoreHistory)
  const providers = useProviderStore(state => state.provider)
  const [rerouteOpen, setRerouteOpen] = useState(false)
  const [rerouteTask, setRerouteTask] = useState<{ id: string } | null>(null)

  // 挂载时补拉全部未归入项目的笔记（batch_id=__none__），
  // 不依赖 hydrateHistory 的执行时序，确保「笔记」tab 列表完整。
  // 只在首次挂载时执行一次（用 ref 防重复），避免与轮询互相干扰
  const fetchedSinglesRef = useRef(false)
  useEffect(() => {
    if (fetchedSinglesRef.current) return
    fetchedSinglesRef.current = true
    let active = true
    void (async () => {
      try {
        const singles = await getHistory({ limit: 500, offset: 0, batch_id: '__none__', light: true })
        if (!active || !Array.isArray(singles) || singles.length === 0) return
        const existingIds = new Set(useTaskStore.getState().tasks.map(t => t.id))
        const missing = singles.filter(item => !existingIds.has(item.task_id))
        for (const item of missing) useTaskStore.getState().upsertHistoryTask(item)
      } catch {
        // 旧后端不支持 __none__ 时静默跳过
      }
    })()
    return () => { active = false }
  }, [])

  const isProviderDisabled = (providerId?: string) => {
    if (!providerId)
      return false
    return providers.find(p => p.id === providerId)?.enabled === 0
  }

  const handleRetry = (input: string | { id: string; formData?: { provider_id?: string; model_name?: string; [k: string]: any }; [k: string]: any }) => {
    const taskObj = typeof input === "string" ? allTasks.find(t => t.id === input) || { id: input } : input
    if (isProviderDisabled(taskObj.formData?.provider_id)) {
      setRerouteTask({ id: taskObj.id })
      setRerouteOpen(true)
      return
    }
    retryTask(taskObj.id)
  }

  const rerouteProviderName = useMemo(() => {
    if (!rerouteTask)
      return undefined
    const t = useTaskStore.getState().tasks.find(x => x.id === rerouteTask.id)
    const pid = t?.formData?.provider_id
    return providers.find(p => p.id === pid)?.name
  }, [rerouteTask, providers])
  const [rawSearch, setRawSearch] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const fuse = useMemo(() => new Fuse(tasks, {
    keys: ['audioMeta.title'],
    threshold: 0.4,
  }), [tasks])

  useEffect(() => {
    setRawSearch(searchValue ?? '')
  }, [searchValue])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(rawSearch)
    }, 300)

    return () => clearTimeout(timer)
  }, [rawSearch])

  const filteredTasks = search.trim()
    ? fuse.search(search).map(result => result.item)
    : tasks

  useEffect(() => {
    setPage(1)
  }, [search])

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / HISTORY_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginatedTasks = filteredTasks.slice((currentPage - 1) * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE)
  const pendingDeleteTask = pendingDeleteTaskId
    ? tasks.find(task => task.id === pendingDeleteTaskId) || null
    : null

  const searchInput = !hideSearch && (
    <div className="mb-2">
      <input
        type="text"
        placeholder="搜索笔记标题…"
        aria-label="搜索笔记标题"
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-blue-100"
        value={rawSearch}
        onChange={e => setRawSearch(e.target.value)}
      />
    </div>
  )

  if (filteredTasks.length === 0) {
    return (
      <>
        {searchInput}
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 py-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">暂无记录</p>
        </div>
      </>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Dialog
        open={!!pendingDeleteTaskId}
        onOpenChange={(open) => {
          if (!open && !isDeletingTask)
            setPendingDeleteTaskId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除这条笔记？</DialogTitle>
            <DialogDescription>
              {pendingDeleteTask
                ? `将删除《${pendingDeleteTask.audioMeta.title || '未命名笔记'}》及其生成结果，该操作不可撤销。`
                : '将删除这条笔记及其生成结果，该操作不可撤销。'}
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
      {searchInput}
      <div className="flex min-w-0 flex-col gap-3 overflow-y-auto pb-3 flex-1 min-h-0 pr-3">
        {paginatedTasks.map(task => (
          <TaskHistoryCard
            key={task.id}
            task={task}
            selected={selectedId === task.id}
            onSelect={onSelect}
            onDelete={setPendingDeleteTaskId}
            onRetry={['FAILED', 'RETRYABLE'].includes(task.status) ? handleRetry : undefined}
          />
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2.5 text-xs text-slate-500 shadow-sm mr-[18px]">
        <span className="tabular-nums">
          第 {currentPage} / {totalPages} 页
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-xl px-2.5"
            disabled={currentPage <= 1}
            onClick={() => setPage(value => Math.max(1, value - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-xl px-2.5"
            disabled={isLoadingMore || (currentPage >= totalPages && !historyHasMore) || totalPages <= 1}
            onClick={async () => {
              if (currentPage < totalPages) {
                setPage(value => Math.min(totalPages, value + 1))
                return
              }
              if (!historyHasMore || isLoadingMore)
                return
              setIsLoadingMore(true)
              try {
                await loadMoreHistory()
                setPage(value => value + 1)
              } finally {
                setIsLoadingMore(false)
              }
            }}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ModelRerouteDialog
        open={rerouteOpen}
        disabledProviderName={rerouteProviderName}
        onOpenChange={setRerouteOpen}
        onSubmit={async (value) => {
          if (!rerouteTask)
            return
          const t = useTaskStore.getState().tasks.find(x => x.id === rerouteTask.id)
          await retryTask(rerouteTask.id, { ...t?.formData, provider_id: value.provider_id, model_name: value.model_name })
          setRerouteOpen(false)
          setRerouteTask(null)
        }}
      />
    </div>
  )
}

export default NoteHistory
