import { readFile } from 'node:fs/promises'

const taskStoreSource = await readFile(new URL('../src/store/taskStore/index.ts', import.meta.url), 'utf8')
const batchPanelSource = await readFile(new URL('../src/pages/HomePage/components/BatchTaskPanel.tsx', import.meta.url), 'utf8')

const taskStoreChecks = [
  'const mergedBatchTasks = items.map((item) => {',
  'return existing ? patchHistoryCardTask(existing, item) : createHistoryTask(item)',
  'if (!existingMap.has(task.id))',
  '[batchId]: items',
]

const batchPanelChecks = [
  'const visibleTaskIds = new Set(group.taskIds)',
  '.filter(item => visibleTaskIds.has(item.task_id))',
  '? remoteItems',
  'TaskHistoryCard',
]

const missingTaskStore = taskStoreChecks.filter(fragment => !taskStoreSource.includes(fragment))
const missingBatchPanel = batchPanelChecks.filter(fragment => !batchPanelSource.includes(fragment))

if (missingTaskStore.length || missingBatchPanel.length) {
  console.error('Batch task card flow verification failed.')
  if (missingTaskStore.length)
    console.error('Missing taskStore fragments:', missingTaskStore.join(', '))
  if (missingBatchPanel.length)
    console.error('Missing BatchTaskPanel fragments:', missingBatchPanel.join(', '))
  process.exit(1)
}

const reconcileStart = taskStoreSource.indexOf('reconcileBatchStatus: (batchId, items, summary, controlState, batchName) =>')
const reconcileEnd = taskStoreSource.indexOf('upsertHistoryTask: item => {', reconcileStart)
const reconcileBlock = taskStoreSource.slice(reconcileStart, reconcileEnd)
if (!reconcileBlock.includes('tasks.unshift(task)') || !reconcileBlock.includes('tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())')) {
  console.error('Batch task card flow verification failed. Reconcile block does not upsert and sort remote tasks.')
  process.exit(1)
}

const remoteItemsBlockStart = batchPanelSource.indexOf('const remoteItems = getBatchItems(group.id)')
const remoteItemsBlockEnd = batchPanelSource.indexOf('const filter = group.filter || \'all\'', remoteItemsBlockStart)
const remoteItemsBlock = batchPanelSource.slice(remoteItemsBlockStart, remoteItemsBlockEnd)
if (!remoteItemsBlock.includes('visibleTaskIds') || !remoteItemsBlock.includes('taskMap.get(item.task_id)')) {
  console.error('Batch task card flow verification failed. Remote batch items are not filtered by visible task ids.')
  process.exit(1)
}

console.log('Batch task card flow verification passed.')
