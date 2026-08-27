import NoteHistory from '@/pages/HomePage/components/NoteHistory.tsx'
import BatchTaskPanel from '@/pages/HomePage/components/BatchTaskPanel.tsx'
import { useTaskStore } from '@/store/taskStore'
import { Clock, Search } from 'lucide-react'
import { Input } from '@/components/ui/input.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx'
import { useMemo, useState } from 'react'

const History = () => {
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)
  const batchGroups = useTaskStore(state => state.batchGroups)
  const tasks = useTaskStore(state => state.tasks)
  const [historySearch, setHistorySearch] = useState('')
  const singleTaskCount = useMemo(() => tasks.filter(task => !task.batchId).length, [tasks])

  return (
    <div className="flex h-full min-w-0 w-full flex-col gap-3 overflow-hidden">
      <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-2.5 shadow-sm sm:p-3">
        <div className="flex min-w-0 items-start gap-2 sm:gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm sm:h-9 sm:w-9 sm:rounded-2xl">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-slate-900">生成历史</h2>
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">搜索最近生成的笔记与批量任务记录</p>
          </div>
        </div>
        <div className="mt-3 flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="搜索笔记标题…"
              aria-label="搜索笔记标题"
              value={historySearch}
              onChange={event => setHistorySearch(event.target.value)}
              className="h-9 min-w-0 rounded-xl border-white bg-white pl-9 text-sm shadow-sm sm:h-10"
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="single" className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <TabsList className="grid w-full shrink-0 grid-cols-2 rounded-2xl bg-slate-100/80 p-1">
          <TabsTrigger value="single" className="rounded-xl text-xs [font-variant-numeric:tabular-nums] sm:text-sm">
            单个任务 ({singleTaskCount})
          </TabsTrigger>
          <TabsTrigger value="batch" className="rounded-xl text-xs [font-variant-numeric:tabular-nums] sm:text-sm">
            批次任务 ({batchGroups.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0 min-w-0 overflow-y-auto pr-2 pb-3">
            <NoteHistory onSelect={setCurrentTask} selectedId={currentTaskId} hideSearch searchValue={historySearch} />
          </div>
        </TabsContent>

        <TabsContent value="batch" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0 min-w-0 overflow-y-auto pr-2 pb-3">
            <BatchTaskPanel onSelect={setCurrentTask} selectedId={currentTaskId} searchValue={historySearch} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default History
