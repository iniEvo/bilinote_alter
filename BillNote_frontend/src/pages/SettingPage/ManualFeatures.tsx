import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle2, Sparkles, ImageOff, ImageIcon } from 'lucide-react'
import { useSystemStore } from '@/store/configStore'

export default function ManualFeatures() {
  const showNoteCover = useSystemStore(state => state.showNoteCover)
  const setShowNoteCover = useSystemStore(state => state.setShowNoteCover)

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
          {/* 按标题重命名 —— 已改为自动 */}
          <Card>
            <CardContent className="flex items-start justify-between gap-4 pt-4">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">按标题重命名</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  把未按视频标题命名的笔记统一重命名为视频标题；后端会在启动时自动执行一次，
                  本地缓存缺失标题时在线补取（不下载视频）。新增笔记生成后自动按标题命名。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-green-500/10 px-3 py-1.5 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                已自动
              </div>
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
