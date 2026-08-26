import { Switch } from '@/components/ui/switch'
import { FC, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AILogo from '@/components/Form/modelForm/Icons'
import { useProviderStore } from '@/store/providerStore'

export interface IProviderCardProps {
  id: string
  providerName: string
  Icon: string
  enable: number
}

const ProviderCard: FC<IProviderCardProps> = ({
  providerName,
  Icon,
  id,
}: IProviderCardProps) => {
  const navigate = useNavigate()
  const updateProvider = useProviderStore(state => state.updateProvider)
  const enabled = useProviderStore(state => state.provider.find(p => p.id === id)?.enabled)

  const isChecked = enabled === 1

  const handleToggle = (checked: boolean) => {
    const allProviders = useProviderStore.getState().provider
    const provider = allProviders.find(p => p.id === id)
    if (!provider) return
    updateProvider({
      ...provider,
      enabled: checked ? 1 : 0,
    })
  }

  // @ts-ignore
  const { id: currentId } = useParams()
  const isActive = currentId === id

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return
    event.preventDefault()
    navigate(`/settings/model/${id}`)
  }

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`编辑模型供应商 ${providerName}`}
      aria-current={isActive ? 'true' : undefined}
      onKeyDown={handleKeyDown}
      onClick={() => navigate(`/settings/model/${id}`)}
      className={
        'flex h-14 cursor-pointer items-center justify-between rounded-xl border p-2 transition-[background-color,border-color,color] hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50' +
        (isActive ? ' border-blue-200 bg-blue-50 font-medium text-blue-700' : ' border-slate-200')
      }
    >
      <div className="flex items-center text-lg">
        <div className="flex h-9 w-9 items-center">
          <AILogo name={Icon} />
        </div>
        <div className="font-semibold">{providerName}</div>
      </div>

      {/* Switch 自己的点击不应该冒泡触发整行跳转 */}
      <div onClick={e => e.stopPropagation()}>
        <Switch
          checked={isChecked}
          onCheckedChange={handleToggle}
          aria-label={`启用 ${providerName}`}
        />
      </div>
    </div>
  )
}
export default ProviderCard
