import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Database,
    FolderOpen,
    RefreshCw,
    Loader2,
    Trash2,
    ShieldAlert,
    Lock,
    HardDrive,
    FileText,
    Timer,
    Check,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
    getArtifacts,
    cleanupArtifacts,
    ArtifactInfo,
    getAutoCleanupConfig,
    saveAutoCleanupConfig,
    runAutoCleanup,
    AutoCleanupConfig,
} from '@/services/artifact'

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** key → 前端友好名称，与后端 AUTO_CLEANABLE_KEYS 保持一致 */
const KEY_LABELS: Record<string, string> = {
    transcript_json: '音频转写文本',
    task_state_json: '任务状态与中间 JSON',
    video_audio_cache: '视频 / 音频缓存',
    screenshots: '笔记配图截图',
    frame_artifacts: '视频抽帧产物',
    uploads: '本地上传文件',
    markdown_notes: 'Markdown 导出副本',
}

const INTERVAL_OPTIONS = [
    { label: '每 1 小时', value: 1 },
    { label: '每 6 小时', value: 6 },
    { label: '每 12 小时', value: 12 },
    { label: '每 24 小时（推荐）', value: 24 },
    { label: '每 3 天', value: 72 },
    { label: '每 7 天', value: 168 },
]

export default function Artifacts() {
    const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // 待二次确认的清理目标；null 表示弹窗关闭
    const [confirmTarget, setConfirmTarget] = useState<ArtifactInfo | null>(null)
    const [cleaningKey, setCleaningKey] = useState<string | null>(null)

    // ── 自动清理 ──
    const [autoCfg, setAutoCfg] = useState<AutoCleanupConfig>({
        enabled: false,
        interval_hours: 24,
        keys: [],
        last_run_at: null,
        available_keys: [],
    })
    const [autoLoading, setAutoLoading] = useState(true)
    const [autoSaving, setAutoSaving] = useState(false)
    const [autoRunning, setAutoRunning] = useState(false)

    const fetchArtifacts = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const data = await getArtifacts()
            setArtifacts(data.artifacts || [])
        } catch {
            setError('无法获取生成物信息，请确认后端服务已启动')
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchAutoConfig = useCallback(async () => {
        try {
            setAutoLoading(true)
            const cfg = await getAutoCleanupConfig()
            setAutoCfg(cfg)
        } catch {
            // 静默：接口可能未就绪
        } finally {
            setAutoLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchArtifacts()
        fetchAutoConfig()
    }, [fetchArtifacts, fetchAutoConfig])

    const handleCleanup = async (target: ArtifactInfo) => {
        setConfirmTarget(null)
        setCleaningKey(target.key)
        try {
            const data = await cleanupArtifacts([target.key])
            const result = data.results?.[0]
            if (result?.status === 'done') {
                toast.success(result.msg)
            } else {
                toast.error(result?.msg || '清理被拒绝')
            }
            await fetchArtifacts()
        } catch {
            // request 拦截器已统一弹出错误提示
        } finally {
            setCleaningKey(null)
        }
    }

    const toggleKey = (key: string) => {
        setAutoCfg(prev => {
            const keys = prev.keys.includes(key)
                ? prev.keys.filter(k => k !== key)
                : [...prev.keys, key]
            return { ...prev, keys }
        })
    }

    const handleSaveAutoConfig = async () => {
        setAutoSaving(true)
        try {
            const cfg = await saveAutoCleanupConfig(autoCfg)
            setAutoCfg(cfg)
            toast.success('自动清理配置已保存')
        } catch {
            // request 拦截器已统一弹出错误提示
        } finally {
            setAutoSaving(false)
        }
    }

    const handleRunAutoCleanup = async () => {
        setAutoRunning(true)
        try {
            const data = await runAutoCleanup()
            const results = data.results || []
            const succeeded = results.filter((r) => r.status === 'done')
            const totalFreed = succeeded.reduce((s, r) => s + (r.freed_bytes || 0), 0)
            const totalRemoved = succeeded.reduce((s, r) => s + (r.removed_files || 0), 0)
            if (succeeded.length > 0) {
                toast.success(
                    `自动清理完成：删除 ${totalRemoved} 个文件，释放 ${formatSize(totalFreed)}`,
                )
            } else {
                const first = results[0]
                toast.error(first?.msg || '没有可清理的文件')
            }
            await fetchArtifacts()
        } catch {
            // request 拦截器已统一弹出错误提示
        } finally {
            setAutoRunning(false)
        }
    }

    const totalSize = artifacts.reduce((sum, a) => sum + a.size_bytes, 0)

    return (
        <ScrollArea className="h-full overflow-y-auto bg-transparent">
            <div className="container mx-auto px-6 py-8">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">存储管理</h1>
                        <p className="text-muted-foreground text-sm">
                            查看笔记生成过程中各类生成物的存储地址与占用，按需清理
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-muted-foreground text-xs">
                            共 {artifacts.length} 类 · 占用约 {formatSize(totalSize)}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                fetchArtifacts()
                                fetchAutoConfig()
                            }}
                            disabled={loading}
                        >
                            {loading ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            刷新
                        </Button>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                        {error}
                    </div>
                )}

                {/* ── 自动清理配置卡片 ── */}
                <Card className="mb-6 border-blue-200 bg-blue-50/60">
                    <CardContent className="pt-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 flex-1 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Timer className="h-4 w-4 text-blue-600" />
                                    <span className="text-sm font-semibold">自动清理</span>
                                    {autoCfg.last_run_at && (
                                        <span className="text-muted-foreground text-xs">
                                            上次执行: {new Date(autoCfg.last_run_at).toLocaleString()}
                                        </span>
                                    )}
                                </div>

                                {/* 开关 */}
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id="auto-cleanup-toggle"
                                        checked={autoCfg.enabled}
                                        onCheckedChange={(checked) =>
                                            setAutoCfg((prev) => ({ ...prev, enabled: checked }))
                                        }
                                        disabled={autoLoading}
                                    />
                                    <Label htmlFor="auto-cleanup-toggle" className="text-sm">
                                        {autoCfg.enabled ? '已开启' : '已关闭'}
                                    </Label>
                                </div>

                                {/* 清理间隔（仅开启时展示） */}
                                {autoCfg.enabled && (
                                    <div className="flex items-center gap-3">
                                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                                            清理周期
                                        </span>
                                        <Select
                                            value={String(autoCfg.interval_hours)}
                                            onValueChange={(v) =>
                                                setAutoCfg((prev) => ({
                                                    ...prev,
                                                    interval_hours: Number(v),
                                                }))
                                            }
                                        >
                                            <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {INTERVAL_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={String(opt.value)}>
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {/* 纳入范围的多选列表 */}
                                {autoCfg.enabled && (
                                    <div className="space-y-1.5">
                                        <span className="text-muted-foreground text-xs">
                                            自动清理范围（至少选一项）
                                        </span>
                                        <div className="flex flex-wrap gap-2">
                                            {(autoCfg.available_keys || []).map((key) => {
                                                const checked = autoCfg.keys.includes(key)
                                                return (
                                                    <button
                                                        key={key}
                                                        type="button"
                                                        onClick={() => toggleKey(key)}
                                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                                            checked
                                                                ? 'border-blue-400 bg-blue-100 text-blue-700'
                                                                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                                        }`}
                                                    >
                                                        {checked && <Check className="h-3 w-3" />}
                                                        {KEY_LABELS[key] || key}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 右侧按钮组 */}
                            <div className="flex shrink-0 items-center gap-2 md:flex-col md:items-end">
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={autoSaving}
                                        onClick={handleSaveAutoConfig}
                                    >
                                        {autoSaving ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <Check className="mr-2 h-4 w-4" />
                                        )}
                                        保存配置
                                    </Button>
                                    <Button
                                        size="sm"
                                        disabled={autoRunning || autoCfg.keys.length === 0}
                                        onClick={handleRunAutoCleanup}
                                    >
                                        {autoRunning ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <Timer className="mr-2 h-4 w-4" />
                                        )}
                                        立即执行
                                    </Button>
                                </div>
                                <span className="text-muted-foreground text-xs">
                                    {autoCfg.keys.length > 0
                                        ? `已选 ${autoCfg.keys.length} 项`
                                        : '请先选择清理范围'}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Artifact list：每个生成物地址独立展示 */}
                <div className="flex flex-col gap-4">
                    {loading && artifacts.length === 0 ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-gray-500">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            加载中...
                        </div>
                    ) : (
                        artifacts.map(item => (
                            <Card key={item.key}>
                                <CardContent className="pt-4">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        {/* 左侧：名称、说明、路径 */}
                                        <div className="min-w-0 flex-1 space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Database className="h-4 w-4 text-blue-500" />
                                                <span className="font-medium">{item.name}</span>
                                                {item.deletable ? (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-green-300 text-green-600"
                                                    >
                                                        可清理
                                                    </Badge>
                                                ) : (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-gray-300 text-gray-500"
                                                    >
                                                        <Lock className="mr-1 h-3 w-3" />
                                                        不建议清理
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-muted-foreground text-sm">
                                                {item.description}
                                            </p>
                                            {/* 每个目录地址独立一行 */}
                                            <div className="space-y-1">
                                                {item.paths.map(path => (
                                                    <div
                                                        key={path}
                                                        className="flex items-center gap-2 rounded bg-gray-50 px-2 py-1"
                                                    >
                                                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                                        <code className="truncate font-mono text-xs text-gray-700">
                                                            {path}
                                                        </code>
                                                    </div>
                                                ))}
                                            </div>
                                            {item.warning && (
                                                <div className="flex items-start gap-1.5 text-xs text-amber-600">
                                                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                                    <span>{item.warning}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* 右侧：占用统计 + 清理按钮 */}
                                        <div className="flex shrink-0 items-center gap-4 md:flex-col md:items-end md:gap-2">
                                            <div className="text-right text-sm">
                                                <div className="flex items-center justify-end gap-1 font-medium">
                                                    <HardDrive className="h-3.5 w-3.5 text-gray-400" />
                                                    {formatSize(item.size_bytes)}
                                                </div>
                                                <div className="flex items-center justify-end gap-1 text-xs text-gray-400">
                                                    <FileText className="h-3 w-3" />
                                                    {item.file_count} 个文件
                                                </div>
                                            </div>
                                            <Button
                                                variant={item.deletable ? 'destructive' : 'outline'}
                                                size="sm"
                                                disabled={!item.deletable || cleaningKey === item.key}
                                                onClick={() => setConfirmTarget(item)}
                                            >
                                                {cleaningKey === item.key ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                )}
                                                清理
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>

                {/* 清理二次确认弹窗 */}
                <Dialog open={!!confirmTarget} onOpenChange={open => !open && setConfirmTarget(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>确认清理「{confirmTarget?.name}」？</DialogTitle>
                            <DialogDescription asChild>
                                <div className="space-y-2">
                                    <p>
                                        将删除该目录下的全部{' '}
                                        <strong>{confirmTarget?.file_count}</strong> 个文件（约{' '}
                                        <strong>{formatSize(confirmTarget?.size_bytes || 0)}</strong>）：
                                    </p>
                                    {confirmTarget?.paths.map(p => (
                                        <code
                                            key={p}
                                            className="block truncate rounded bg-gray-100 px-2 py-1 font-mono text-xs"
                                        >
                                            {p}
                                        </code>
                                    ))}
                                    {confirmTarget?.warning && (
                                        <p className="font-medium text-amber-600">
                                            ⚠️ {confirmTarget.warning}
                                        </p>
                                    )}
                                    <p>此操作不可撤销，请确认后再继续。</p>
                                </div>
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
                                取消
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => confirmTarget && handleCleanup(confirmTarget)}
                            >
                                确认清理
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </ScrollArea>
    )
}
