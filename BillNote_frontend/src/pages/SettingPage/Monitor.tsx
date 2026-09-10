import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Server,
    Cpu,
    AudioLines,
    Film,
    RefreshCw,
    CheckCircle2,
    XCircle,
    Loader2,
    FolderOpen,
    Save,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
    getDeployStatus,
    getBinPathsConfig,
    saveBinPathsConfig,
    DeployStatus,
    BinPathsConfig,
} from '@/services/system'

export default function Monitor() {
    const [status, setStatus] = useState<DeployStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

    // 路径配置
    const [binPaths, setBinPaths] = useState<BinPathsConfig>({
        ffmpeg_path: '',
        whisper_model_dir: '',
        effective_ffmpeg: '',
        effective_ffprobe: '',
        effective_whisper_dir: '',
    })
    const [editingFfmpeg, setEditingFfmpeg] = useState(false)
    const [editingWhisper, setEditingWhisper] = useState(false)
    const [ffmpegInput, setFfmpegInput] = useState('')
    const [whisperInput, setWhisperInput] = useState('')
    const [savingPath, setSavingPath] = useState(false)

    const fetchStatus = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const data = await getDeployStatus()
            setStatus(data)
            setLastUpdated(new Date())
        } catch {
            setError('无法连接到后端服务')
            setStatus(null)
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchBinPaths = useCallback(async () => {
        try {
            const cfg = await getBinPathsConfig()
            setBinPaths(cfg)
            setFfmpegInput(cfg.ffmpeg_path)
            setWhisperInput(cfg.whisper_model_dir)
        } catch {
            // 静默
        }
    }, [])

    useEffect(() => {
        fetchStatus()
        fetchBinPaths()
        const interval = setInterval(fetchStatus, 30000)
        return () => clearInterval(interval)
    }, [fetchStatus, fetchBinPaths])

    const handleSaveFfmpeg = async () => {
        setSavingPath(true)
        try {
            await saveBinPathsConfig({ ffmpeg_path: ffmpegInput || '' })
            toast.success('FFmpeg 路径已更新')
            setEditingFfmpeg(false)
            await Promise.all([fetchStatus(), fetchBinPaths()])
        } catch {
            // request 拦截器已弹 toast
        } finally {
            setSavingPath(false)
        }
    }

    const handleSaveWhisper = async () => {
        setSavingPath(true)
        try {
            await saveBinPathsConfig({ whisper_model_dir: whisperInput || '' })
            toast.success('Whisper 模型目录已更新')
            setEditingWhisper(false)
            await Promise.all([fetchStatus(), fetchBinPaths()])
        } catch {
            // request 拦截器已弹 toast
        } finally {
            setSavingPath(false)
        }
    }

    const StatusBadge = ({ ok, label }: { ok: boolean; label?: string }) => (
        <Badge
            variant={ok ? 'default' : 'destructive'}
            className={ok ? 'bg-green-500 hover:bg-green-600' : ''}
        >
            {ok ? (
                <><CheckCircle2 className="mr-1 h-3 w-3" />{label || '正常'}</>
            ) : (
                <><XCircle className="mr-1 h-3 w-3" />{label || '异常'}</>
            )}
        </Badge>
    )

    return (
        <ScrollArea className="h-full overflow-y-auto bg-transparent">
            <div className="container mx-auto px-6 py-8">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">部署监控</h1>
                        <p className="text-muted-foreground text-sm">
                            实时监控系统各组件运行状态
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        {lastUpdated && (
                            <span className="text-muted-foreground text-xs">
                                最后更新: {lastUpdated.toLocaleTimeString()}
                            </span>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { fetchStatus(); fetchBinPaths(); }}
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

                {/* Status Cards */}
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {/* Backend FastAPI */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-lg font-medium">
                                <Server className="mr-2 inline h-5 w-5 text-blue-500" />
                                后端 FastAPI
                            </CardTitle>
                            {status && <StatusBadge ok={status.backend.status === 'running'} label="运行中" />}
                        </CardHeader>
                        <CardContent>
                            {loading && !status ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    加载中…
                                </div>
                            ) : status ? (
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">状态:</span>
                                        <span className={status.backend.status === 'running' ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
                                            {status.backend.status === 'running' ? '运行中' : status.backend.status}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">端口:</span>
                                        <span className="font-mono">{status.backend.port}</span>
                                    </div>
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>

                    {/* CUDA GPU */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-lg font-medium">
                                <Cpu className="mr-2 inline h-5 w-5 text-green-500" />
                                CUDA GPU
                            </CardTitle>
                            {status && <StatusBadge ok={status.cuda.available} label={status.cuda.available ? '已启用' : '未启用'} />}
                        </CardHeader>
                        <CardContent>
                            {loading && !status ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    加载中…
                                </div>
                            ) : status ? (
                                <div className="space-y-2 text-sm">
                                    {status.cuda.available ? (
                                        <>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">GPU:</span>
                                                <span className="font-medium">{status.cuda.gpu_name}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">CUDA 版本:</span>
                                                <span className="font-mono">{status.cuda.version}</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-muted-foreground">
                                            CUDA 不可用，将使用 CPU 模式
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>

                    {/* Whisper Model */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-lg font-medium">
                                <AudioLines className="mr-2 inline h-5 w-5 text-purple-500" />
                                Whisper 模型
                            </CardTitle>
                            {status && (() => {
                                const isLocal = status.whisper.transcriber_type === 'fast-whisper' || status.whisper.transcriber_type === 'mlx-whisper'
                                if (!isLocal) return <StatusBadge ok={true} label="在线引擎" />
                                return <StatusBadge ok={status.whisper.downloaded} label={status.whisper.downloaded ? '已下载' : '未下载'} />
                            })()}
                        </CardHeader>
                        <CardContent>
                            {loading && !status ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    加载中…
                                </div>
                            ) : status ? (
                                <div className="space-y-3 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">模型大小:</span>
                                        <span className="font-medium">{status.whisper.model_size}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">转写引擎:</span>
                                        <span className="font-mono">{status.whisper.transcriber_type}</span>
                                    </div>
                                    {(status.whisper.transcriber_type === 'fast-whisper' || status.whisper.transcriber_type === 'mlx-whisper') && (
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">本地下载:</span>
                                            <span className={status.whisper.downloaded ? 'font-medium text-green-600' : 'font-medium text-amber-600'}>
                                                {status.whisper.downloaded ? '已就绪' : '未下载（首次转写会触发下载）'}
                                            </span>
                                        </div>
                                    )}

                                    {/* 模型目录 + 编辑 */}
                                    {status.whisper.model_dir && (
                                        <div className="space-y-1.5 border-t pt-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground text-xs">模型目录</span>
                                                <button
                                                    type="button"
                                                    className="text-xs text-blue-600 hover:underline"
                                                    onClick={() => { setEditingWhisper(true); setWhisperInput(binPaths.whisper_model_dir) }}
                                                >
                                                    修改
                                                </button>
                                            </div>
                                            <code className="flex items-center gap-1.5 rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">
                                                <FolderOpen className="h-3 w-3 shrink-0 text-gray-400" />
                                                <span className="truncate">{status.whisper.model_dir}</span>
                                            </code>
                                            {binPaths.whisper_model_dir && (
                                                <span className="text-xs text-amber-600">手动配置路径生效中</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>

                    {/* FFmpeg */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-lg font-medium">
                                <Film className="mr-2 inline h-5 w-5 text-orange-500" />
                                FFmpeg
                            </CardTitle>
                            {status && <StatusBadge ok={status.ffmpeg.available} label={status.ffmpeg.available ? '可用' : '不可用'} />}
                        </CardHeader>
                        <CardContent>
                            {loading && !status ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    加载中…
                                </div>
                            ) : status ? (
                                <div className="space-y-3 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">状态:</span>
                                        <span className={status.ffmpeg.available ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
                                            {status.ffmpeg.available ? '已安装' : '未安装'}
                                        </span>
                                    </div>
                                    {!status.ffmpeg.available && (
                                        <div className="text-xs text-red-500">
                                            请安装 FFmpeg 并添加到系统 PATH，或手动指定路径
                                        </div>
                                    )}

                                    {/* 可执行文件路径 + 编辑 */}
                                    {status.ffmpeg.executable && (
                                        <div className="space-y-1.5 border-t pt-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground text-xs">可执行文件</span>
                                                <button
                                                    type="button"
                                                    className="text-xs text-blue-600 hover:underline"
                                                    onClick={() => { setEditingFfmpeg(true); setFfmpegInput(binPaths.ffmpeg_path) }}
                                                >
                                                    修改
                                                </button>
                                            </div>
                                            <code className="flex items-center gap-1.5 rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">
                                                <FolderOpen className="h-3 w-3 shrink-0 text-gray-400" />
                                                <span className="truncate">{status.ffmpeg.executable}</span>
                                            </code>
                                            {binPaths.ffmpeg_path && (
                                                <span className="text-xs text-amber-600">手动配置路径生效中</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                </div>

                {/* Footer Info */}
                <div className="mt-8 text-center text-xs text-gray-400">
                    状态每 30 秒自动刷新
                </div>
            </div>

            {/* ── FFmpeg 路径编辑弹窗 ── */}
            <Dialog open={editingFfmpeg} onOpenChange={open => !open && setEditingFfmpeg(false)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>配置 FFmpeg 路径</DialogTitle>
                        <DialogDescription>
                            填写 ffmpeg 可执行文件的完整路径（如 /opt/homebrew/bin/ffmpeg）。
                            留空则恢复自动检测（优先 FFMPEG_BIN_PATH 环境变量，其次系统 PATH）。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <Label>ffmpeg 完整路径</Label>
                        <Input
                            value={ffmpegInput}
                            onChange={e => setFfmpegInput(e.target.value)}
                            placeholder="留空 = 自动检测"
                        />
                        {binPaths.effective_ffmpeg && (
                            <p className="text-muted-foreground text-xs">
                                当前生效: <code className="font-mono">{binPaths.effective_ffmpeg}</code>
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingFfmpeg(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSaveFfmpeg} disabled={savingPath}>
                            {savingPath ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Whisper 模型目录编辑弹窗 ── */}
            <Dialog open={editingWhisper} onOpenChange={open => !open && setEditingWhisper(false)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>配置 Whisper 模型目录</DialogTitle>
                        <DialogDescription>
                            指定 whisper 模型的父目录（其下应有 whisper/ 和/或 mlx-whisper/ 子目录）。
                            留空则使用默认位置 backend/models/。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <Label>模型父目录</Label>
                        <Input
                            value={whisperInput}
                            onChange={e => setWhisperInput(e.target.value)}
                            placeholder="留空 = 默认 backend/models"
                        />
                        {binPaths.effective_whisper_dir && (
                            <p className="text-muted-foreground text-xs">
                                当前生效: <code className="font-mono">{binPaths.effective_whisper_dir}</code>
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingWhisper(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSaveWhisper} disabled={savingPath}>
                            {savingPath ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </ScrollArea>
    )
}
