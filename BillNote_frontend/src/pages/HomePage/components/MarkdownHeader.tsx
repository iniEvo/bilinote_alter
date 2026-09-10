'use client'

import { useEffect, useState } from 'react'
import { Copy, Download, BrainCircuit, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'

interface VersionNote {
  ver_id: string
  model_name?: string
  style?: string
  created_at?: string
}

interface NoteHeaderProps {
  currentTask?: {
    markdown: VersionNote[] | string
  }
  isMultiVersion: boolean
  currentVerId: string
  setCurrentVerId: (id: string) => void
  modelName: string
  style: string
  noteStyles: { value: string; label: string }[]
  onCopy: () => void
  onDownload: () => void
  createAt?: string | Date
  setShowTranscribe: (show: boolean) => void
  showChat?: false | 'half' | 'full'
  setShowChat?: (mode: false | 'half' | 'full') => void
}

export function MarkdownHeader({
  currentTask,
  isMultiVersion,
  currentVerId,
  setCurrentVerId,
  modelName,
  style,
  noteStyles,
  onCopy,
  onDownload,
  createAt,
  showTranscribe,
  setShowTranscribe,
  showChat,
  setShowChat,
  viewMode,
  setViewMode,
}: NoteHeaderProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (copied) {
      timer = setTimeout(() => setCopied(false), 2000)
    }
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = () => {
    onCopy()
    setCopied(true)
  }

  const styleName = noteStyles.find(v => v.value === style)?.label || style

  const reversedMarkdown: VersionNote[] = Array.isArray(currentTask?.markdown)
    ? [...currentTask!.markdown].reverse()
    : []

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return ''
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return ''
    return d
      .toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(/\//g, '-')
  }

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-t-[24px] border-b border-slate-200/80 bg-white/96 px-3 py-2 backdrop-blur-md">
      {/* 左侧区域：版本 + 标签 + 创建时间 */}
      <div className="min-w-0 flex flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
        {isMultiVersion && (
          <Select value={currentVerId} onValueChange={setCurrentVerId}>
            <SelectTrigger className="h-8 w-[118px] max-w-full rounded-xl border-slate-200 bg-white text-sm shadow-sm sm:w-[132px]">
              <div className="flex items-center">
                {(() => {
                  const idx = currentTask?.markdown.findIndex(v => v.ver_id === currentVerId)
                  return idx !== -1 ? `版本（${currentVerId.slice(-6)}）` : ''
                })()}
              </div>
            </SelectTrigger>

            <SelectContent>
              {(currentTask?.markdown || []).map((v, idx) => {
                const shortId = v.ver_id.slice(-6)
                return (
                  <SelectItem key={v.ver_id} value={v.ver_id}>
                    {`版本（${shortId}）`}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}

        <Badge variant="secondary" className="max-w-[120px] truncate rounded-full bg-gradient-to-r from-pink-50 to-rose-50 px-2 text-pink-700 ring-1 ring-inset ring-pink-200/60 hover:bg-pink-100 sm:max-w-[160px]">
          {modelName}
        </Badge>
        <Badge variant="secondary" className="max-w-[96px] truncate rounded-full bg-gradient-to-r from-cyan-50 to-sky-50 px-2 text-cyan-700 ring-1 ring-inset ring-cyan-200/60 hover:bg-cyan-100 sm:max-w-[120px]">
          {styleName}
        </Badge>

        {createAt && (
          <div className="max-w-[150px] truncate text-xs text-slate-500 sm:max-w-[220px] sm:text-sm">创建时间: {formatDate(createAt)}</div>
        )}
      </div>

      {/* 右侧操作按钮 */}
      <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 overflow-hidden">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  setViewMode(viewMode == 'preview' ? 'map' : 'preview')
                }}
                variant="ghost"
                size="sm"
                className="h-8 rounded-xl px-2 text-xs sm:text-sm"
              >
                <BrainCircuit className="mr-1.5 h-4 w-4" />
                <span className="truncate text-xs sm:text-sm">{viewMode == 'preview' ? '思维导图' : 'markdown'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>思维导图</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={handleCopy} variant="ghost" size="sm" className="h-8 min-w-0 rounded-xl px-2 text-xs sm:text-sm">
                <Copy className="mr-1.5 h-4 w-4" />
                <span className="truncate text-xs sm:text-sm">{copied ? '已复制' : '复制'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>复制内容</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onDownload} variant="ghost" size="sm" className="h-8 min-w-0 rounded-xl px-2 text-xs sm:text-sm">
                <Download className="mr-1.5 h-4 w-4" />
                <span className="truncate text-xs sm:text-sm">导出 Markdown</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载为 Markdown 文件</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  setShowTranscribe(!showTranscribe)
                }}
                variant="ghost"
                size="sm"
                className="h-8 rounded-xl px-2 text-xs sm:text-sm"
              >
                {/*<Download className="mr-1.5 h-4 w-4" />*/}
                <span className="truncate text-xs sm:text-sm">原文参照</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>原文参照</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {setShowChat && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setShowChat(showChat ? false : 'half')}
                  variant={showChat ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 rounded-xl px-2 text-xs sm:text-sm"
                >
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  <span className="truncate text-xs sm:text-sm">AI 问答</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>基于笔记内容的 AI 问答</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}
