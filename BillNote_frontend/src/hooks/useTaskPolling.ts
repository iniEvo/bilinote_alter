import { useEffect, useRef } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { get_task_status } from '@/services/note.ts'
import toast from 'react-hot-toast'

export const useTaskPolling = (interval = 3000) => {
  const tasks = useTaskStore(state => state.tasks)
  const updateTaskContent = useTaskStore(state => state.updateTaskContent)
  const refreshHistoryList = useTaskStore(state => state.refreshHistoryList)

  const tasksRef = useRef(tasks)

  // 每次 tasks 更新，把最新的 tasks 同步进去
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    const timer = setInterval(async () => {
      // 仅刷新历史列表，不改动当前表单/预览选择。
      await refreshHistoryList()

      const pendingTasks = tasksRef.current.filter(
        task => !['SUCCESS', 'FAILED', 'RETRYABLE'].includes(task.status)
      )

      // 无活跃任务时跳过状态轮询，但保留上面的历史同步。
      if (pendingTasks.length === 0) return

      for (const task of pendingTasks) {
        try {
          const res = await get_task_status(task.id)
          const { status } = res

          if (status && status !== task.status) {
            if (status === 'SUCCESS') {
              const { markdown, transcript, audio_meta } = res.result
              toast.success('笔记生成成功')
              updateTaskContent(task.id, {
                status,
                markdown,
                transcript,
                audioMeta: audio_meta,
                message: res.message,
              })
            } else if (status === 'FAILED' || status === 'RETRYABLE') {
              updateTaskContent(task.id, { status, message: res.message || '任务失败' })
              console.warn(`⚠️ 任务 ${task.id} ${status === 'RETRYABLE' ? '连接中断，可重试' : '失败'}`)
            } else {
              updateTaskContent(task.id, { status, message: res.message })
            }
          }
        } catch (e) {
          // Keep the last known task status on transient polling errors.
          console.error('❌ 任务轮询失败：', e)
        }
      }
    }, interval)

    return () => clearInterval(timer)
  }, [interval, refreshHistoryList, updateTaskContent])
}
