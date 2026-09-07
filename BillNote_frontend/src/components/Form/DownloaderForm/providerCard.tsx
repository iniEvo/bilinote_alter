import { Switch } from '@/components/ui/switch.tsx'
import { FC, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AILogo from '@/components/Form/modelForm/Icons'
import { useProviderStore } from '@/store/providerStore'
export interface IProviderCardProps {
  id: string
  providerName: string
  Icon: any
}
const ProviderCard: FC<IProviderCardProps> = ({ providerName, Icon, id }: IProviderCardProps) => {
  const navigate = useNavigate()
  const handleClick = () => {
    navigate(`/settings/download/${id}`)
  }

  const { id: currentId } = useParams()
  const isActive = currentId === id

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return
    event.preventDefault()
    handleClick()
  }

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`配置 ${providerName} 下载`}
      aria-current={isActive ? 'true' : undefined}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      className={
        'flex h-14 cursor-pointer items-center justify-between rounded-xl border px-2 py-3 transition-[background-color,border-color,color] hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50' +
        (isActive ? ' border-blue-200 bg-blue-50 font-medium text-blue-700' : ' border-slate-200')
      }
    >
      <div className="flex items-center gap-2 text-lg">
        <div className="flex h-6 w-6 items-center">
          <Icon />
        </div>
        <div className="font-semibold">{providerName}</div>
      </div>
    </div>
  )
}
export default ProviderCard
