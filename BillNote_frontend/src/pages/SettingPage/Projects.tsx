import { useNavigate } from 'react-router-dom'
import BatchTaskPanel from '@/pages/HomePage/components/BatchTaskPanel.tsx'
import { useTaskStore } from '@/store/taskStore'

const Projects = () => {
  const navigate = useNavigate()
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)
  const setKeepFormDraft = useTaskStore(state => state.setKeepFormDraft)

  const handleSelectTask = (taskId: string) => {
    setCurrentTask(taskId)
    setKeepFormDraft(false)
    navigate('/')
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <BatchTaskPanel onSelect={handleSelectTask} selectedId={null} />
    </div>
  )
}

export default Projects
