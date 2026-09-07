import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import { Link, Outlet } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'
import React from 'react'
import logo from '@/assets/icon.svg'

interface ISettingLayoutProps {
  Menu: React.ReactNode
}
const SettingLayout = ({ Menu }: ISettingLayoutProps) => {
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      {/* 背景氛围光 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_35%),linear-gradient(135deg,#eef4ff_0%,#f7f9fc_42%,#eef2ff_100%)]" />
      </div>

      <div className="relative z-10 flex h-full">
        {/* 左侧部分：Header + 表单 */}
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/60 bg-white/82 pr-3 backdrop-blur-xl">
          {/* Header */}
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100/80 px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-400 to-indigo-500 p-1.5 shadow-lg shadow-blue-500/20">
                <img src={logo} alt="logo" className="h-full w-full object-contain" />
              </div>
              <div className="text-xl font-semibold text-slate-900">BiliNote</div>
            </div>
            <div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={'/'}
                      aria-label="返回首页"
                      className="rounded-xl p-2 text-slate-500 transition-[color,background-color] hover:bg-white hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <SlidersHorizontal aria-hidden="true" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>返回首页</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </header>

          {/* 表单内容 */}
          <div className="flex-1 overflow-auto p-4">
            {/*<NoteForm />*/}
            {Menu}
          </div>
        </aside>

        {/* 右侧预览区域 */}
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden pl-3 pr-3">
          <div className="h-full overflow-y-auto overflow-x-hidden rounded-l-3xl border-l border-white/60 bg-white/86 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
export default SettingLayout
