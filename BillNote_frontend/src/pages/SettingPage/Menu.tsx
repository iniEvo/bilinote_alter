import {
  BotMessageSquare,
  Captions,
  HardDriveDownload,
  Info,
  Activity,
  DatabaseBackup,
  Wrench,
} from 'lucide-react'
import MenuBar, { IMenuProps } from '@/pages/SettingPage/components/menuBar.tsx'

const Menu = () => {
  const menuList: IMenuProps[] = [
    {
      id: 'model',
      name: 'AI 模型设置',
      icon: <BotMessageSquare />,
      path: '/settings/model',
    },
    {
      id: 'transcriber',
      name: '音频转写配置',
      icon: <Captions />,
      path: '/settings/transcriber',
    },
    {
      id: 'download',
      name: '下载配置',
      icon: <HardDriveDownload />,
      path: '/settings/download',
    },
    // //其他配置
    // {
    //   id: 'prompt',
    //   name: '提示词设置',
    //   icon: <SquareChevronRight />,
    //   path: '/settings/prompt',
    // },
    {
      id: 'manual',
      name: '手动功能',
      icon: <Wrench />,
      path: '/settings/manual',
    },
    {
      id: 'monitor',
      name: '部署监控',
      icon: <Activity />,
      path: '/settings/monitor',
    },
    {
      id: 'artifacts',
      name: '存储管理',
      icon: <DatabaseBackup />,
      path: '/settings/artifacts',
    },
    {
      id: 'about',
      name: '关于',
      icon: <Info />,
      path: '/settings/about',
    },
    // {
    //   id: 'other',
    //   name: '其他配置',
    //   icon: <Wrench />,
    //   path: '/settings/other',
    // },
  ]
  return (
    <div className="flex h-full flex-col">
      <div className={'flex w-full flex-col gap-2'}>
        <h1 className="text-2xl font-medium">设置</h1>
        <p className="text-sm font-light text-slate-600">全局配置与模型设置</p>
      </div>
      <div className="mt-6 flex-1">
        {menuList &&
          menuList.map(item => {
            return <MenuBar key={item.id} menuItem={item} />
          })}
      </div>
    </div>
  )
}
export default Menu
