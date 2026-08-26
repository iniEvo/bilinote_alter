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
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
    getArtifacts,
    cleanupArtifacts,
    ArtifactInfo,
} from '@/services/artifact'

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function Artifacts() {
    const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // 待二次确认的清理目标；null 表示弹窗关闭
    const [confirmTarget, setConfirmTarget] = useState<ArtifactInfo | null>(null)
    const [cleaningKey, setCleaningKey] = useState<string | null>(null)

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

    useEffect(() => {
        fetchArtifacts()
    }, [fetchArtifacts])

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

    const totalSize = artifacts.reduce((sum, a) => sum + a.size_bytes, 0)

    return (
        <ScrollArea className="h-full overflow-y-auto bg-white">
            <div className="container mx-auto px-4 py-8">
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
                            onClick={fetchArtifacts}
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
