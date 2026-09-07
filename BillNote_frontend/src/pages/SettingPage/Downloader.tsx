import { Outlet } from 'react-router-dom'
import Options from '@/components/Form/DownloaderForm/Options.tsx'
import ProxyConfig from '@/components/Form/DownloaderForm/ProxyConfig.tsx'
const Downloader = () => {
  return (
    <div className={'flex h-full bg-transparent'}>
      <div className={'flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-100/80 pl-3 pr-4 py-2'}>
        <ProxyConfig />
        <Options></Options>
      </div>
      <div className={'min-w-0 flex-1 overflow-y-auto'}>
        <Outlet />
      </div>
    </div>
  )
}
export default Downloader
