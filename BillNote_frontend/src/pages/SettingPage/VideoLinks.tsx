import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { getHistory } from '@/services/note'
import { Button } from '@/components/ui/button'

interface HistoryItem {
  task_id: string
  video_id?: string
  platform: string
  source_url?: string
  title?: string
  status: string
  created_at?: string
}

const PLATFORM_LABELS: Record<string, string> = {
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  douyin: '抖音',
  kuaishou: '快手',
  local: '本地',
}

const PLATFORM_COLORS: Record<string, string> = {
  bilibili: 'bg-pink-100 text-pink-700',
  youtube: 'bg-red-100 text-red-700',
  douyin: 'bg-slate-800 text-white',
  kuaishou: 'bg-orange-100 text-orange-700',
  local: 'bg-gray-100 text-gray-700',
}

const PAGE_SIZE = 20

const VideoLinks: FC = () => {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activePlatform, setActivePlatform] = useState<string>('all')
  const [page, setPage] = useState(1)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const allItems: HistoryItem[] = []
      let offset = 0
      const limit = 256
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const data = await getHistory({ limit, offset }) as HistoryItem[]
        if (!Array.isArray(data) || data.length === 0) break
        allItems.push(...data)
        if (data.length < limit) break
        offset += limit
      }
      setItems(allItems)
    }
    catch {
      // ignore
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) {
      const p = item.platform || 'unknown'
      counts[p] = (counts[p] || 0) + 1
    }
    return counts
  }, [items])

  const platforms = useMemo(() => {
    return Object.keys(platformCounts).sort((a, b) => platformCounts[b] - platformCounts[a])
  }, [platformCounts])

  const filteredItems = useMemo(() => {
    if (activePlatform === 'all') return items
    return items.filter(item => item.platform === activePlatform)
  }, [items, activePlatform])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, safePage])

  // reset page when platform changes
  useEffect(() => { setPage(1) }, [activePlatform])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">视频笔记链接</h2>
          <p className="text-sm text-slate-500">按平台分类浏览所有已生成笔记的视频链接</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadHistory()}>刷新</Button>
      </div>

      {/* platform tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActivePlatform('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            activePlatform === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          全部 ({items.length})
        </button>
        {platforms.map(p => (
          <button
            key={p}
            onClick={() => setActivePlatform(p)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activePlatform === p
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {PLATFORM_LABELS[p] || p} ({platformCounts[p]})
          </button>
        ))}
      </div>

      {/* table */}
      {loading
        ? (
          <div className="py-8 text-center text-sm text-slate-400">加载中…</div>
        )
        : pagedItems.length === 0
          ? (
            <div className="py-8 text-center text-sm text-slate-400">暂无数据</div>
          )
          : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">平台</th>
                    <th className="px-3 py-2">标题</th>
                    <th className="px-3 py-2">链接</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedItems.map(item => (
                    <tr key={item.task_id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${PLATFORM_COLORS[item.platform] || 'bg-gray-100 text-gray-700'}`}>
                          {PLATFORM_LABELS[item.platform] || item.platform}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-slate-700" title={item.title || ''}>
                        {item.title || item.video_id || '未命名'}
                      </td>
                      <td className="px-3 py-2">
                        {item.source_url
                          ? (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                              title={item.source_url}
                            >
                              打开 <ExternalLink className="h-3 w-3" />
                            </a>
                          )
                          : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs ${item.status === 'SUCCESS' ? 'text-green-600' : item.status === 'FAILED' ? 'text-red-500' : item.status === 'RETRYABLE' ? 'text-amber-500' : 'text-slate-400'}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                        {item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>共 {filteredItems.length} 条，第 {safePage} / {totalPages} 页</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default VideoLinks
