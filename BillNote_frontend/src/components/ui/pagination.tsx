import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils.ts'

interface PaginationProps {
  page: number
  totalPages: number
  total?: number
  onChange: (page: number) => void
  pageSize?: number
  pageSizeOptions?: number[]
  onPageSizeChange?: (size: number) => void
  className?: string
  size?: 'sm' | 'md'
}

/**
 * 页码导航组件。
 * 页数较多时自动折叠中间页码（省略号），并保证首尾页可直达。
 * 支持每页条数选择、跳转到指定页、总条数显示。
 */
const Pagination = ({
  page,
  totalPages,
  total,
  onChange,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  className,
  size = 'sm',
}: PaginationProps) => {
  const safeTotal = Math.max(1, totalPages)
  const current = Math.min(Math.max(1, page), safeTotal)

  const [gotoValue, setGotoValue] = useState('')
  const gotoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setGotoValue('')
  }, [current])

  // 生成页码序列：最多 5 个数字 + 省略号（首、尾、当前及相邻）
  const buildPages = (): Array<number | '...'> => {
    if (safeTotal <= 5) {
      return Array.from({ length: safeTotal }, (_, i) => i + 1)
    }
    const pages = new Set<number>([1, safeTotal, current, current - 1, current + 1])
    const sorted = [...pages].filter(p => p >= 1 && p <= safeTotal).sort((a, b) => a - b)
    const result: Array<number | '...'> = []
    let prev = 0
    for (const p of sorted) {
      if (p - prev > 1) result.push('...')
      result.push(p)
      prev = p
    }
    return result
  }

  const btnBase = size === 'sm'
    ? 'h-6 min-w-6 px-1.5 text-[11px]'
    : 'h-8 min-w-8 px-2 text-sm'

  const handleGoto = () => {
    const n = parseInt(gotoValue, 10)
    if (!isNaN(n) && n >= 1 && n <= safeTotal && n !== current) {
      onChange(n)
    }
    setGotoValue('')
  }

  // 始终渲染分页控件（单页时按钮呈禁用态），避免「看不见分页」的困惑
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1', className)}>
      {typeof total === 'number' && (
        <span className={cn('whitespace-nowrap text-slate-400', size === 'sm' ? 'text-[11px]' : 'text-xs')}>
          共 {total} 条
        </span>
      )}

      {/* 每页条数选择 */}
      {pageSize !== undefined && onPageSizeChange && pageSizeOptions && pageSizeOptions.length > 0 && (
        <select
          value={pageSize}
          onChange={e => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v > 0) onPageSizeChange(v)
          }}
          className={cn(
            'rounded-lg border border-slate-200 bg-white px-1.5 text-slate-600 transition-colors hover:border-blue-200 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100',
            size === 'sm' ? 'h-6 text-[11px]' : 'h-8 text-xs',
          )}
        >
          {pageSizeOptions.map(n => (
            <option key={n} value={n}>{n} 条/页</option>
          ))}
        </select>
      )}

      <button
        type="button"
        aria-label="上一页"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
        className={cn(
          btnBase,
          'flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {buildPages().map((p, i) =>
        p === '...'
          ? (
            <span key={`e-${i}`} className={cn('whitespace-nowrap text-slate-400', size === 'sm' ? 'text-[11px]' : 'text-xs')}>
              …
            </span>
          )
          : (
            <button
              key={p}
              type="button"
              aria-current={p === current ? 'page' : undefined}
              onClick={() => onChange(p)}
              className={cn(
                btnBase,
                'flex items-center justify-center rounded-lg border font-medium transition-colors',
                p === current
                  ? 'border-blue-500 bg-blue-500 text-white shadow-sm shadow-blue-400/40'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-600',
              )}
            >
              {p}
            </button>
          ),
      )}
      <button
        type="button"
        aria-label="下一页"
        disabled={current >= safeTotal}
        onClick={() => onChange(current + 1)}
        className={cn(
          btnBase,
          'flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>

      {/* 跳转到指定页 */}
      {safeTotal > 5 && (
        <div className="flex items-center gap-1">
          <span className={cn('whitespace-nowrap text-slate-400', size === 'sm' ? 'text-[11px]' : 'text-xs')}>
            跳至
          </span>
          <input
            ref={gotoRef}
            type="number"
            min={1}
            max={safeTotal}
            value={gotoValue}
            onChange={e => setGotoValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleGoto()
            }}
            onBlur={handleGoto}
            className={cn(
              'rounded-lg border border-slate-200 bg-white text-center text-slate-600 outline-none transition-[border-color,box-shadow] hover:border-blue-200 focus:border-blue-300 focus:ring-2 focus:ring-blue-100',
              size === 'sm' ? 'h-6 w-12 text-[11px]' : 'h-8 w-14 text-xs',
            )}
            placeholder={`${current}`}
          />
          <span className={cn('whitespace-nowrap text-slate-400', size === 'sm' ? 'text-[11px]' : 'text-xs')}>
            页
          </span>
        </div>
      )}
    </div>
  )
}

export default Pagination
