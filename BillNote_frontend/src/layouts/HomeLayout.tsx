import React, { FC, useRef, useState } from 'react'
import { SlidersHorizontal, PanelLeftClose, PanelLeftOpen, History as HistoryIcon, Search as SearchIcon } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'

import { Link } from 'react-router-dom'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { Input } from '@/components/ui/input.tsx'
import logo from '@/assets/icon.svg'

interface IProps {
  NoteForm: React.ReactNode
  Preview: React.ReactNode
  History: React.ReactNode
}

interface HistoryPanelProps {
  searchValue?: string
}

const panelShellClass =
  'relative z-10 flex h-full flex-col overflow-hidden border border-white/60 bg-white/80 shadow-[0_20px_50px_rgba(15,23,42,0.07)] backdrop-blur-xl'

const iconButtonClass =
  'cursor-pointer rounded-xl border border-transparent p-2 text-slate-500 transition-[color,border-color,background-color,box-shadow] hover:border-blue-100 hover:bg-white hover:text-primary hover:shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const collapsedButtonClass =
  'relative z-20 flex h-full w-10 shrink-0 items-center justify-center border-r border-white/50 bg-white/70 backdrop-blur-xl transition-colors hover:bg-white/90'

const HomeLayout: FC<IProps> = ({ NoteForm, Preview, History }) => {
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [isMiddleCollapsed, setIsMiddleCollapsed] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const middlePanelRef = useRef<ImperativePanelHandle>(null)

  const historyNode = React.isValidElement(History)
    ? React.cloneElement(History as React.ReactElement<HistoryPanelProps>, { searchValue: historySearch })
    : History

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_35%),linear-gradient(135deg,#eef4ff_0%,#f7f9fc_42%,#eef2ff_100%)]" />
      </div>

      <div className="relative z-10 flex-1 overflow-hidden p-3 md:p-4">
        <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-3 overflow-hidden">
          <ResizablePanel
            ref={leftPanelRef}
            defaultSize={18}
            minSize={12}
            maxSize={30}
            collapsible
            collapsedSize={0}
            onCollapse={() => setIsLeftCollapsed(true)}
            onExpand={() => setIsLeftCollapsed(false)}
          >
            <aside className={`${panelShellClass} rounded-[24px]`}>
              <header className="border-b border-slate-100/80 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-400 to-indigo-500 p-2 shadow-lg shadow-blue-500/20 transition-transform duration-200 hover:scale-105">
                      <img src={logo} alt="logo" className="h-full w-full object-contain" />
                    </div>
                    <div>
                      <div className="text-xl font-semibold tracking-tight text-slate-900">BiliNote</div>
                      <div className="mt-0.5 text-sm text-slate-500">配置输入源、模型和生成偏好</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => leftPanelRef.current?.collapse()}
                            aria-label="收起工作区"
                            className={iconButtonClass}
                          >
                            <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>收起工作区</span>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link to={'/settings'} aria-label="全局配置" className={iconButtonClass}>
                            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>全局配置</span>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </header>
              <div className="flex-1 overflow-y-auto">
                <div className="p-3 md:p-4">{NoteForm}</div>
              </div>
            </aside>
          </ResizablePanel>

          <ResizableHandle className="relative z-30 w-2 shrink-0 cursor-col-resize bg-transparent after:bg-slate-200/80 after:w-1 hover:after:bg-primary/70" />

          {isLeftCollapsed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => leftPanelRef.current?.expand()}
                    aria-label="展开工作区"
                    className={collapsedButtonClass}
                  >
                    <PanelLeftOpen className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <span>展开工作区</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <ResizablePanel
            ref={middlePanelRef}
            defaultSize={18}
            minSize={14}
            maxSize={30}
            collapsible
            collapsedSize={0}
            onCollapse={() => setIsMiddleCollapsed(true)}
            onExpand={() => setIsMiddleCollapsed(false)}
          >
            <aside className={`${panelShellClass} rounded-[24px]`}>
              <header className="border-b border-slate-100/80 px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-900">
                      <HistoryIcon className="h-4 w-4 text-blue-500" aria-hidden="true" />
                      生成历史
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">快速回看单次与批量任务</div>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => middlePanelRef.current?.collapse()}
                          aria-label="收起历史"
                          className={iconButtonClass}
                        >
                          <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span>收起历史</span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {/* 搜索框 */}
                <div className="relative mt-3">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)}
                    placeholder="搜索笔记标题或项目名称"
                    className="h-9 rounded-xl border-slate-200/80 bg-slate-50/70 pl-9 text-xs shadow-none transition-[border-color,background-color,box-shadow] focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pt-3 pb-4">
                {historyNode}
              </div>
            </aside>
          </ResizablePanel>

          <ResizableHandle className="relative z-30 w-2 shrink-0 cursor-col-resize bg-transparent after:bg-slate-200/80 after:w-1 hover:after:bg-primary/70" />

          {isMiddleCollapsed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => middlePanelRef.current?.expand()}
                    aria-label="展开历史"
                    className={collapsedButtonClass}
                  >
                    <HistoryIcon className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <span>展开历史</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <ResizablePanel defaultSize={59} minSize={30} className="min-w-0 overflow-hidden">
            <main className="flex h-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white/86 p-3 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl md:p-4">
              {Preview}
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

export default HomeLayout
