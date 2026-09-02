import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertTriangle } from 'lucide-react'
import { useModelStore } from '@/store/modelStore'
import { useProviderStore } from '@/store/providerStore'

export interface ModelRerouteValue {
  provider_id: string
  model_name: string
}

interface ModelRerouteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (value: ModelRerouteValue) => void
  loading?: boolean
  /** 原供应商名称，用于提示用户「该供应商已关闭」 */
  disabledProviderName?: string
  defaultProviderId?: string
  defaultModelName?: string
  title?: string
  description?: string
  confirmLabel?: string
}

/**
 * 统一的「选择新模型」弹窗：当某个笔记绑定的模型供应商已被关闭时，
 * 用于引导用户改用其他已启用的供应商/模型，而不是静默沿用已失效配置。
 * 模型列表来自后端 /model_list（仅包含启用的供应商）。
 */
const ModelRerouteDialog = ({
  open,
  onOpenChange,
  onSubmit,
  loading,
  disabledProviderName,
  defaultProviderId,
  defaultModelName,
  title = '原模型供应商已关闭',
  description = '该任务绑定的模型供应商已关闭，请选择一个已启用的供应商与模型后重试。',
  confirmLabel = '用此模型重试',
}: ModelRerouteDialogProps) => {
  const modelList = useModelStore(state => state.modelList)
  const loadEnabledModels = useModelStore(state => state.loadEnabledModels)
  const providers = useProviderStore(state => state.provider)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (open)
      loadEnabledModels()
  }, [open, loadEnabledModels])

  const providerNameOf = (providerId: string) =>
    providers.find(p => p.id === providerId)?.name || providerId

  const options = useMemo(
    () =>
      modelList.map(m => ({
        key: `${m.provider_id}::${m.model_name}`,
        provider_id: m.provider_id,
        model_name: m.model_name,
        label: `${providerNameOf(m.provider_id)} / ${m.model_name}`,
      })),
    [modelList, providers],
  )

  useEffect(() => {
    if (!open || options.length === 0) {
      setSelected('')
      return
    }
    const defaultKey =
      options.find(o => o.provider_id === defaultProviderId && o.model_name === defaultModelName)?.key
    setSelected(defaultKey || options[0].key)
  }, [open, options, defaultProviderId, defaultModelName])

  const current = options.find(o => o.key === selected)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {disabledProviderName && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>原供应商「{disabledProviderName}」已关闭，无法继续使用。</span>
          </div>
        )}

        {options.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            当前没有可用的已启用模型，请先在「设置 → 模型供应商」中启用一个供应商并添加模型。
          </div>
        ) : (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500">选择新模型</span>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full" aria-label="选择新模型">
                <SelectValue placeholder="请选择模型" />
              </SelectTrigger>
              <SelectContent>
                {options.map(opt => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={loading || !current}
            onClick={() => current && onSubmit({ provider_id: current.provider_id, model_name: current.model_name })}
          >
            {loading && <span className="mr-1.5 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ModelRerouteDialog
