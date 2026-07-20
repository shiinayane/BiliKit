/**
 * 回程的纯逻辑层（无 DOM / sessionStorage / location 依赖）——可单测。
 * 有副作用的部分（读写 sessionStorage、location.replace、渲染）留在 index.ts。
 */
export type Entry = { url: string; title: string; t: number }

const TITLE_SUFFIX = /[_-](哔哩哔哩|bilibili|番剧|动画|电影|电视剧|纪录片|综艺|国创|在线观看|全集)([_-]?(哔哩哔哩|bilibili|番剧|动画|电影|电视剧|纪录片|综艺|国创|在线观看|全集))*$/i

// 提取「同一个视频」标识：BV/av、番剧/课程 ep/ss、或 /list/ 播放页查询串里的 bvid。相对 href 按 base 解析。
export function videoIdOf(href: string, base = 'https://www.bilibili.com'): string {
  try {
    const u = new URL(href, base)
    const p = u.pathname
    return p.match(/\/video\/(BV\w+|av\d+)/i)?.[1]?.toLowerCase()
      || p.match(/\/(?:bangumi|cheese)\/play\/((ep|ss)\d+)/i)?.[1]?.toLowerCase()
      || (u.searchParams.get('bvid') || '').toLowerCase()
      || ''
  } catch { return '' }
}

/** 仅同源播放页 A→B 算跨视频 SPA 导航；同视频 query / 分 P 与非播放页保留原生历史。 */
export function shouldFlattenVideoNavigation(current: string, target: string): boolean {
  try {
    const fromUrl = new URL(current)
    const toUrl = new URL(target, fromUrl)
    if (fromUrl.origin !== toUrl.origin) return false
    const from = videoIdOf(fromUrl.href, fromUrl.href)
    const to = videoIdOf(toUrl.href, fromUrl.href)
    return !!from && !!to && from !== to
  } catch {
    return false
  }
}

// 剥掉标题串尾的站点后缀段（SPA 后 B 站会把 title 改成「_哔哩哔哩bilibili」等）
export function cleanTitle(raw: string): string {
  return (raw || '').replace(TITLE_SUFFIX, '').trim()
}

// 到达去重（纯）：返回处理后的栈。栈顶与当前视频相同（刷新/原生返回/分P）→ 弹掉；
// backRestore 时先回退到最近一个「当前视频」层，再弹掉尾部同视频。只做尾部裁剪、不重排。
export function dedupeArrival(stack: Entry[], curId: string, base = 'https://www.bilibili.com', backRestore = false): Entry[] {
  if (!curId) return stack
  let s = stack
  if (backRestore) {
    let i = s.length - 1
    while (i >= 0 && videoIdOf(s[i].url, base) !== curId) i--
    if (i >= 0) s = s.slice(0, i + 1)
  }
  let n = s.length
  while (n && videoIdOf(s[n - 1].url, base) === curId) n--
  return n !== s.length ? s.slice(0, n) : s
}
