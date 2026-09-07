// src/pages/NotFoundPage.tsx
import NotFound from '@/components/Lottie/404.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useNavigate } from 'react-router-dom'
import { Home } from 'lucide-react'

const NotFoundPage = () => {
  const navigate = useNavigate()

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-slate-950 text-slate-600">
      {/* 背景氛围光 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_35%),linear-gradient(135deg,#eef4ff_0%,#f7f9fc_42%,#eef2ff_100%)]" />
      </div>

      <div className="relative z-10 flex flex-col items-center rounded-[32px] border border-white/60 bg-white/82 p-10 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl md:p-14">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[32px]">
          <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-blue-100/60 blur-2xl" />
          <div className="absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-cyan-100/70 blur-2xl" />
        </div>
        <div className="relative text-center">
          <h1 className="mb-4 text-4xl font-semibold text-slate-900">你好像走丢了哦！～～</h1>
          <p className="mb-6 text-lg text-slate-500">请检查你的网址是否正确，或者点击下面的按钮返回首页。</p>
          <Button
            onClick={() => navigate('/')}
            className="gap-2 shadow-lg shadow-blue-500/20"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Button>
        </div>
        <div className="relative mt-6">
          <NotFound />
        </div>
      </div>
    </div>
  )
}

export default NotFoundPage