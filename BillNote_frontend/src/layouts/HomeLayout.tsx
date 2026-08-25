import React, { FC, useRef, useState } from 'react'
import { SlidersHorizontal, PanelLeftClose, PanelLeftOpen, History as HistoryIcon } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'

import { Link } from 'react-router-dom'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import logo from '@/assets/icon.svg'

interface IProps {
  NoteForm: React.ReactNode
  Preview: React.ReactNode
  History: React.ReactNode
}

const panelShellClass =
  'relative z-10 flex h-full flex-col overflow-hidden border border-white/60 bg-white/82 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl'

const iconButtonClass =
  'cursor-pointer rounded-xl border border-transparent p-2 text-slate-500 transition-all hover:border-blue-100 hover:bg-white hover:text-primary hover:shadow-sm'

const collapsedButtonClass =
  'relative z-20 flex h-full w-10 shrink-0 items-center justify-center border-r border-white/50 bg-white/70 backdrop-blur-xl transition-colors hover:bg-white/90'

const HomeLayout: FC<IProps> = ({ NoteForm, Preview, History }) => {
  const [, setShowSettings] = useState(false)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [isMiddleCollapsed, setIsMiddleCollapsed] = useState(false)
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const middlePanelRef = useRef<ImperativePanelHandle>(null)

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_35%),linear-gradient(135deg,#eef4ff_0%,#f7f9fc_42%,#eef2ff_100%)]" />
      </div>

      <div className="relative z-10 flex items-center justify-between border-b border-white/40 bg-white/55 px-5 py-3 backdrop-blur-xl">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.32em] text-slate-500">AI Video Notes Studio</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">把视频快速整理成更好读的结构化笔记</div>
        </div>
        <div className="hidden items-center gap-3 rounded-2xl border border-white/60 bg-white/70 px-4 py-2 text-sm text-slate-600 shadow-sm backdrop-blur md:flex">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          支持单条、批量与本地视频生成
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-hidden p-3 md:p-4">
        <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-3 overflow-hidden">
          <ResizablePanel
            ref={leftPanelRef}
            defaultSize={23}
            minSize={14}
            maxSize={35}
            collapsible
            collapsedSize={0}
            onCollapse={() => setIsLeftCollapsed(true)}
            onExpand={() => setIsLeftCollapsed(false)}
          >
            <aside className={`${panelShellClass} rounded-[24px]`}>
              <header className="border-b border-slate-100/80 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-400 to-indigo-500 p-2 shadow-lg shadow-blue-500/20">
                      <img src={logo} alt="logo" className="h-full w-full object-contain" />
                    </div>
                    <div>
                      <div className="text-xl font-semibold text-slate-900">BiliNote</div>
                      <div className="mt-1 text-sm text-slate-500">配置输入源、模型和生成偏好</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => leftPanelRef.current?.collapse()}
                            className={iconButtonClass}
                          >
                            <PanelLeftClose className="h-5 w-5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>收起工作区</span>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger onClick={() => setShowSettings(true)}>
                          <Link to={'/settings'} className={iconButtonClass}>
                            <SlidersHorizontal className="h-5 w-5" />
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
              <ScrollArea className="flex-1 overflow-auto">
                <div className="p-3 md:p-4">{NoteForm}</div>
              </ScrollArea>
            </aside>
          </ResizablePanel>

          <ResizableHandle className="relative z-30 w-2 shrink-0 cursor-col-resize bg-transparent after:bg-slate-200/80 after:w-1 hover:after:bg-primary/70" />

          {isLeftCollapsed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => leftPanelRef.current?.expand()}
                    className={collapsedButtonClass}
                  >
                    <PanelLeftOpen className="h-4 w-4 text-slate-500" />
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
                    <div className="text-sm font-semibold text-slate-900">生成历史</div>
                    <div className="mt-1 text-xs text-slate-500">快速回看单次与批量任务</div>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => middlePanelRef.current?.collapse()}
                          className={iconButtonClass}
                        >
                          <PanelLeftClose className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span>收起历史</span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pt-2.5 pb-4">
                {History}
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
                    className={collapsedButtonClass}
                  >
                    <HistoryIcon className="h-4 w-4 text-slate-500" />
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
