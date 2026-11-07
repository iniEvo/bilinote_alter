import { useEffect, useRef } from 'react'
import { useTaskStore, type Task } from '@/store/taskStore'
import { get_task_status } from '@/services/note.ts'
import toast from 'react-hot-toast'

const hasTaskContent = (markdown: Task['markdown']): boolean =>
  typeof markdown === 'string'
    ? markdown.length > 0
    : Array.isArray(markdown) && markdown.length > 0

export const useTaskPolling = (interval = 3000) => {
  const tasks = useTaskStore(state => state.tasks)
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const updateTaskContent = useTaskStore(state => state.updateTaskContent)
  const refreshHistoryList = useTaskStore(state => state.refreshHistoryList)

  const tasksRef = useRef(tasks)
  const currentTaskIdRef = useRef(currentTaskId)

  // 每次 tasks 更新，把最新的 tasks 同步进去
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    currentTaskIdRef.current = currentTaskId
  }, [currentTaskId])

  useEffect(() => {
    const timer = setInterval(async () => {
      // 仅刷新历史列表，不改动当前表单/预览选择。
      await refreshHistoryList()

      const pendingTasks = tasksRef.current.filter(
        task => !['SUCCESS', 'FAILED', 'RETRYABLE'].includes(task.status),
      )

      // 仅对「不在任何 batch 内的单条任务」逐个轮询状态：
      // batch 内的任务已被 refreshHistoryList → getBatchStatus(batchId, light) 覆盖，
      // 无需再逐个调 /task_status/{id}（原实现串行 200+ 请求是轮询卡顿主因之一）。
      const orphanTasks = pendingTasks.filter(task => !task.batchId)

      for (const task of orphanTasks) {
        try {
          const res = await get_task_status(task.id)
          const { status } = res

          if (status && status !== task.status) {
            if (status === 'SUCCESS') {
              const result = res.result
              if (result?.markdown) {
                const { markdown, transcript, audio_meta } = result
                toast.success('笔记生成成功')
                updateTaskContent(task.id, {
                  status,
                  markdown,
                  // 正文 JSON 缺字段时保留已有转写/封面，避免 undefined 覆盖
                  ...(transcript ? { transcript } : {}),
                  ...(audio_meta ? { audioMeta: audio_meta } : {}),
                  message: res.message,
                })
              } else {
                // 状态文件已 SUCCESS 但正文尚未就绪：只推进状态，
                // 正文由下方「预览中任务的正文补拉」持续兜底（避免对 undefined 解构崩溃）
                updateTaskContent(task.id, { status, message: res.message })
              }
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

      // 正文兜底：light 轮询只刷状态不带正文。当前预览中的任务若已是 SUCCESS
      // 但正文还没落地（刷新页面、批次任务刚完成等场景），预览区会停在
      // 「输入视频链接…」空占位。对这一条（最多 1 条）单独补拉，直到正文到达。
      const selectedId = currentTaskIdRef.current
      const selectedTask = selectedId ? tasksRef.current.find(task => task.id === selectedId) : undefined
      if (selectedTask?.status === 'SUCCESS' && !hasTaskContent(selectedTask.markdown)) {
        try {
          const res = await get_task_status(selectedTask.id)
          const result = res?.result
          if (result?.markdown) {
            updateTaskContent(selectedTask.id, {
              status: 'SUCCESS',
              markdown: result.markdown,
              ...(result.transcript ? { transcript: result.transcript } : {}),
              ...(result.audio_meta ? { audioMeta: result.audio_meta } : {}),
              message: res.message,
            })
          }
        } catch (e) {
          console.error('❌ 预览任务正文补拉失败：', e)
        }
      }
    }, interval)

    return () => clearInterval(timer)
  }, [interval, refreshHistoryList, updateTaskContent])
}
