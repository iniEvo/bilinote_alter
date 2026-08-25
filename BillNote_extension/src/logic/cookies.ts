import { setDownloaderCookie } from './api'
import type { Platform } from './types'

// 后端期望的 cookie 字符串格式：name=value; name=value; ...
// 见 backend/app/downloaders/bilibili_downloader.py 的 split("; ")
const COOKIE_SCOPES: Record<Exclude<Platform, 'local'>, { domain?: string, url?: string }> = {
  bilibili: { domain: '.bilibili.com' },
  youtube: { domain: '.youtube.com' },
  // Douyin 登录态里既有 .douyin.com 的域 cookie，也可能有 www.douyin.com 的 host-only cookie。
  // 直接按 URL 读取更稳，能拿到当前站点实际可见的 cookie 集合。
  douyin: { url: 'https://www.douyin.com/' },
  kuaishou: { domain: '.kuaishou.com' },
}

export const SUPPORTED_COOKIE_PLATFORMS: Array<Exclude<Platform, 'local'>> = [
  'bilibili',
  'douyin',
  'kuaishou',
  'youtube',
]

export async function readBrowserCookies(platform: Exclude<Platform, 'local'>): Promise<string> {
  const scope = COOKIE_SCOPES[platform]
  const list = await browser.cookies.getAll(scope)
  const byName = new Map<string, string>()
  for (const cookie of list) {
    if (!cookie.name)
      continue
    byName.set(cookie.name, `${cookie.name}=${cookie.value}`)
  }
  return [...byName.values()].join('; ')
}

export async function syncCookieToBackend(platform: Exclude<Platform, 'local'>): Promise<{ ok: boolean, count: number, error?: string }> {
  try {
    const cookieStr = await readBrowserCookies(platform)
    if (!cookieStr)
      return { ok: false, count: 0, error: '当前浏览器没有该域名的 cookie，先在浏览器内登录目标站点' }
    const count = cookieStr.split('; ').length
    await setDownloaderCookie(platform, cookieStr)
    return { ok: true, count }
  }
  catch (e) {
    return { ok: false, count: 0, error: (e as Error).message }
  }
}
