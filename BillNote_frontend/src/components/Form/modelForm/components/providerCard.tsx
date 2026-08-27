import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FC, KeyboardEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AILogo from '@/components/Form/modelForm/Icons'
import { useProviderStore } from '@/store/providerStore'
import toast from 'react-hot-toast'

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
}) => {
  const navigate = useNavigate()
  const updateProvider = useProviderStore(state => state.updateProvider)
  const deleteProvider = useProviderStore(state => state.deleteProvider)
  const enabled = useProviderStore(state => state.provider.find(p => p.id === id)?.enabled)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const ok = await deleteProvider(id)
      if (ok) {
        toast.success(`已删除模型供应商「${providerName}」`)
        // 若当前正在编辑的正是被删供应商，跳回新增页避免孤儿路由
        if (isActive) navigate('/settings/model/new')
      } else {
        toast.error('删除失败，请稍后重试')
      }
    } catch {
      toast.error('删除失败，请稍后重试')
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
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
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <Switch
          checked={isChecked}
          onCheckedChange={handleToggle}
          aria-label={`启用 ${providerName}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`删除模型供应商 ${providerName}`}
          title="删除"
          disabled={deleting}
          onClick={() => setConfirmOpen(true)}
          className="h-8 w-8 rounded-lg text-slate-400 transition-[color,background-color] hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={open => !open && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除「{providerName}」？</DialogTitle>
            <DialogDescription>
              删除后该供应商及其下所有模型配置将一并移除，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
export default ProviderCard
