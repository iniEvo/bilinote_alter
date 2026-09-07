import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tag, Loader2, ImageOff, ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { useState } from 'react'
import { useSystemStore } from '@/store/configStore'
import { useTaskStore } from '@/store/taskStore'
import { fixNoteTitles } from '@/services/note.ts'

export default function ManualFeatures() {
  const showNoteCover = useSystemStore(state => state.showNoteCover)
  const setShowNoteCover = useSystemStore(state => state.setShowNoteCover)
  const refreshHistoryList = useTaskStore(state => state.refreshHistoryList)
  const [isFixingTitles, setIsFixingTitles] = useState(false)

  const handleFixTitles = async () => {
    if (isFixingTitles)
      return
    setIsFixingTitles(true)
    try {
      // fetch_online=true：本地缓存缺失标题时，在线补取视频标题（不下载视频）
      const result = await fixNoteTitles(true)
      const fixedCount = result.fixed_count || 0
      const failedCount = result.failed?.length || 0
      if (fixedCount > 0) {
        await refreshHistoryList()
      }
      if (failedCount > 0) {
        const cookieIssue = result.failed.some(item => (item.reason || '').includes('Cookie'))
        toast.error(
          `已重命名 ${fixedCount} 条，${failedCount} 条失败${cookieIssue ? '（抖音 Cookie 已失效，请在设置中更新）' : ''}`,
          { duration: 5000 },
        )
      } else if (fixedCount > 0) {
        toast.success(`已将 ${fixedCount} 个笔记重命名为视频标题`)
      } else {
        toast('所有笔记均已按视频标题命名')
      }
    } catch (error) {
      console.error('重命名笔记失败:', error)
      toast.error('重命名失败，请稍后重试')
    } finally {
      setIsFixingTitles(false)
    }
  }

  return (
    <ScrollArea className="h-full overflow-y-auto bg-transparent">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">手动功能</h1>
          <p className="text-muted-foreground text-sm">
            需要手动触发的维护操作与界面展示开关
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* 按标题重命名 */}
          <Card>
            <CardContent className="flex items-start justify-between gap-4 pt-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">按标题重命名</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  把未按视频标题命名的笔记统一重命名为视频标题；本地缓存缺失标题时会在线补取（不下载视频）
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isFixingTitles}
                onClick={handleFixTitles}
                className="shrink-0"
              >
                {isFixingTitles
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Tag className="mr-2 h-4 w-4" />}
                {isFixingTitles ? '重命名中…' : '立即执行'}
              </Button>
            </CardContent>
          </Card>

          {/* 封面展示开关 */}
          <Card>
            <CardContent className="flex items-center justify-between gap-4 pt-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  {showNoteCover
                    ? <ImageIcon className="h-4 w-4 text-blue-500" />
                    : <ImageOff className="h-4 w-4 text-gray-400" />}
                  <span className="font-medium">展示笔记封面</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  开启后在生成历史列表与笔记页顶部横幅中展示视频封面；关闭后仅显示文字信息
                </p>
              </div>
              <Switch
                checked={showNoteCover}
                onCheckedChange={setShowNoteCover}
                aria-label="切换是否展示笔记封面"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </ScrollArea>
  )
}
