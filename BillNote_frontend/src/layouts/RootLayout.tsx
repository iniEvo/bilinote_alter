import type { ReactNode, FC } from 'react'
// import "@/global.css"
import { Toaster } from 'react-hot-toast'

interface RootLayoutProps {
  children: ReactNode
}

export const metadata = {
  title: 'BiliNote - 视频笔记生成器',
  description: '通过视频链接结合大模型自动生成对应的笔记',
}

/**
 * 全局根布局：固定为视口高度（h-screen）并禁止横向/纵向溢出，
 * 保证内部页面使用的 h-full / min-h-0 flex 高度链不被内容撑破。
 */
const RootLayout: FC<RootLayoutProps> = ({ children }) => {
  return (
    <div className="h-screen w-full overflow-hidden bg-neutral-100 font-sans text-neutral-900">
      <Toaster
        position="top-center" // 顶部居中显示
        toastOptions={{
          style: {
            borderRadius: '8px',
            background: '#333',
            color: '#fff',
          },
        }}
      />
      {children}
    </div>
  )
}

export default RootLayout