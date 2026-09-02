import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FolderOpen, FolderOutput, Loader2, RotateCcw, Save, Info, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { getOutputConfig, updateOutputConfig, OutputConfig } from '@/services/outputConfig'

export default function OutputPath() {
  const [config, setConfig] = useState<OutputConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dir, setDir] = useState('')

  const load = async () => {
    try {
      const data = await getOutputConfig()
      setConfig(data)
      setDir(data.markdown_output_dir || '')
    } catch {
      toast.error('获取输出目录配置失败，请确认后端已启动')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const isDefault = !(config?.markdown_output_dir || '').trim()

  const handleSave = async () => {
    const trimmed = dir.trim()
    setSaving(true)
    try {
      const data = await updateOutputConfig(trimmed)
      setConfig(data)
      setDir(data.markdown_output_dir || '')
      toast.success(trimmed ? '输出目录已更新' : '已恢复默认目录')
    } catch (e) {
      // 后端已通过响应拦截器统一 toast 错误详情（含路径校验失败）
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setDir('')
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-semibold">存储位置</h2>
        <p className="mt-1 text-sm text-neutral-500">
          设置生成的 Markdown 笔记文件的保存目录，保存后对新任务立即生效
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FolderOutput className="h-5 w-5" />
            Markdown 笔记保存目录
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">保存目录</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <FolderOpen className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  className="pl-9"
                  placeholder="留空则使用默认目录，例如 /Users/me/Notes"
                  value={dir}
                  onChange={e => setDir(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Markdown 保存目录"
                />
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" onClick={handleReset} disabled={saving || !dir}>
                  <RotateCcw className="mr-1 h-4 w-4" />
                  重置
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-4 w-4" />
                  )}
                  保存
                </Button>
              </div>
            </div>
            <p className="text-xs text-neutral-400">
              支持绝对路径（如 <code className="rounded bg-neutral-100 px-1">/Users/xxx/我的笔记</code>）
              或相对路径（相对后端目录）。留空恢复默认目录。
            </p>
          </div>

          {config && (
            <div className="rounded-md border bg-neutral-50 px-4 py-3">
              <div className="flex items-start gap-2 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-500">当前生效目录：</span>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <code className="break-all font-mono text-xs text-neutral-700">
                      {config.effective_markdown_dir}
                    </code>
                  </div>
                  <div className="text-xs text-neutral-400">
                    {isDefault ? '正在使用默认目录' : '已使用自定义目录'}
                  </div>
                </div>
              </div>
            </div>
          )}

          <Alert className="text-sm">
            <AlertDescription>
              此设置只影响 <strong>.md 文件的落盘位置</strong>（用于导出或本地打开）。
              前端历史记录与笔记正文展示不受影响（它们读取的是笔记 JSON，目录不变）。
              已在默认目录里生成的历史 .md 文件不会自动迁移到新目录。
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}