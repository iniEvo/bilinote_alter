import NoteHistory from '@/pages/HomePage/components/NoteHistory.tsx'
import BatchTaskPanel from '@/pages/HomePage/components/BatchTaskPanel.tsx'
import { useTaskStore } from '@/store/taskStore'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx'
import { useMemo } from 'react'

interface HistoryProps {
  searchValue?: string
}

const History = ({ searchValue = '' }: HistoryProps) => {
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)
  const batchGroups = useTaskStore(state => state.batchGroups)
  const tasks = useTaskStore(state => state.tasks)
  const singleTaskCount = useMemo(() => tasks.filter(task => !task.batchId).length, [tasks])

  return (
    <div className="flex h-full min-w-0 w-full flex-col gap-3 overflow-hidden">
      <Tabs defaultValue="single" className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <TabsList className="grid w-full shrink-0 grid-cols-2 rounded-2xl bg-slate-100/80 p-1 backdrop-blur">
          <TabsTrigger value="single" className="rounded-xl text-xs font-medium [font-variant-numeric:tabular-nums] sm:text-sm">
            笔记 ({singleTaskCount})
          </TabsTrigger>
          <TabsTrigger value="batch" className="rounded-xl text-xs font-medium [font-variant-numeric:tabular-nums] sm:text-sm">
            项目 ({batchGroups.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0 min-w-0 overflow-y-auto pb-3">
            <NoteHistory onSelect={setCurrentTask} selectedId={currentTaskId} hideSearch searchValue={searchValue} />
          </div>
        </TabsContent>

        <TabsContent value="batch" className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden pb-3">
            <BatchTaskPanel onSelect={setCurrentTask} selectedId={currentTaskId} searchValue={searchValue} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default History
