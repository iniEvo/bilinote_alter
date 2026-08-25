import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pages/HomePage/components/NoteForm.tsx', import.meta.url), 'utf8')

const requiredFragments = [
  'continuingRemainingDuplicates',
  'handleContinueAllRemainingDuplicates',
  'duplicate_confirm_urls: confirmUrls',
  "disabled={continuingRemainingDuplicates}",
  "正在批量提交…",
  '本轮剩余全部继续',
]

const missing = requiredFragments.filter(fragment => !source.includes(fragment))
if (missing.length > 0) {
  console.error('Duplicate flow verification failed. Missing:', missing.join(', '))
  process.exit(1)
}

const handlerStart = source.indexOf('const handleContinueAllRemainingDuplicates')
const handlerEnd = source.indexOf('const handleOpenDuplicateTask', handlerStart)
const handler = source.slice(handlerStart, handlerEnd)
if (!handler.includes('setContinuingRemainingDuplicates(true)') || !handler.includes('setContinuingRemainingDuplicates(false)')) {
  console.error('Duplicate flow verification failed. Loading guard is incomplete.')
  process.exit(1)
}

console.log('Duplicate flow verification passed.')
