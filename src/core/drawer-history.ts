export const DRAWER_HISTORY_KEY = '__bilikitDrawer'
export const DRAWER_ORIGIN_KEY = '__bilikitDrawerOrigin'
export const DRAWER_FRAME_PREFIX = 'bilikit-drawer:'
export const DRAWER_DOCUMENT_NAV_KEY = 'bilikit-drawer-document-navigation'
export const DRAWER_MARK = '#bk-drawer'
export const DRAWER_WEB_MARK = '#bk-drawer-web'

export interface DrawerHistoryRoute {
  token: string
  url: string
  cover: string
  webFull: boolean
  immersive: boolean
}

export interface DrawerFrameIdentity {
  token: string
  webFull: boolean
}

export interface DrawerLoadedDocument extends DrawerFrameIdentity {
  url: string
}

/** 只有同一抽屉会话的同一文档才能直接复开；新 token 即使 URL 相同也必须重载，让子页拿到新身份。 */
export function canReuseDrawerDocument(loaded: DrawerLoadedDocument, route: DrawerHistoryRoute): boolean {
  return !!loaded.token && loaded.token === route.token && loaded.url === route.url && loaded.webFull === route.webFull
}

export function drawerFrameName(route: Pick<DrawerHistoryRoute, 'token' | 'webFull'>): string {
  return `${DRAWER_FRAME_PREFIX}${route.token}:${route.webFull ? 'web' : 'plain'}`
}

export function readDrawerFrameName(name: string): DrawerFrameIdentity | null {
  if (!name.startsWith(DRAWER_FRAME_PREFIX)) return null
  const rest = name.slice(DRAWER_FRAME_PREFIX.length)
  const split = rest.lastIndexOf(':')
  if (split <= 0) return null
  const token = rest.slice(0, split)
  const mode = rest.slice(split + 1)
  if (!/^[0-9a-z-]{8,}$/i.test(token) || (mode !== 'web' && mode !== 'plain')) return null
  return { token, webFull: mode === 'web' }
}

export function drawerMark(hash: string): typeof DRAWER_MARK | typeof DRAWER_WEB_MARK | null {
  if (hash === DRAWER_MARK) return DRAWER_MARK
  if (hash === DRAWER_WEB_MARK) return DRAWER_WEB_MARK
  return null
}

/** 只接受当前 iframe origin 下的 B 站播放页，拒绝跨站/账号页伪造 location 消息。 */
export function safeDrawerVideoUrl(target: string, expectedOrigin: string): string | null {
  try {
    const next = new URL(target)
    if (next.origin !== expectedOrigin || !/(^|\.)bilibili\.com$/i.test(next.hostname)) return null
    if (!/^\/(?:video\/(?:BV[0-9A-Za-z]+|av\d+)|bangumi\/play\/(?:ep|ss)\d+|cheese\/play\/(?:ep|ss)\d+|list\/|festival\/)/i.test(next.pathname)) return null
    if (drawerMark(next.hash)) next.hash = ''
    return next.href
  } catch {
    return null
  }
}

/** 抽屉内只对能稳定识别内容 ID 的播放页强制整页换文档；列表/活动页交给站点自身处理。 */
export function drawerPlayableId(target: string, base = target): string | null {
  try {
    const url = new URL(target, base)
    const path = url.pathname
    const video = path.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)/i)?.[1]
    if (video) return `video:${video.toLowerCase()}`
    const bangumi = path.match(/^\/bangumi\/play\/((?:ep|ss)\d+)/i)?.[1]
    if (bangumi) return `bangumi:${bangumi.toLowerCase()}`
    const cheese = path.match(/^\/cheese\/play\/((?:ep|ss)\d+)/i)?.[1]
    if (cheese) return `cheese:${cheese.toLowerCase()}`
    if (/^\/(?:list|festival)\//i.test(path)) {
      const bvid = url.searchParams.get('bvid')
      if (bvid && /^BV[0-9A-Za-z]+$/i.test(bvid)) return `video:${bvid.toLowerCase()}`
      const aid = url.searchParams.get('aid') || url.searchParams.get('oid')
      if (aid && /^\d+$/.test(aid)) return `video:av${aid}`
    }
    return null
  } catch {
    return null
  }
}

/**
 * 不同视频/剧集/分 P 摧毁旧 SPA；同一内容的无关 query 变化继续交给站点。
 * `allowSeasonCanonicalization` 只给站点自身的 replaceState/URL 观测使用：`ss -> ep`
 * 常是首次落地的规范化，不应再触发第二次整页导航。真实点击/pushState 仍换 Document。
 */
export function shouldReplaceDrawerDocument(
  current: string,
  target: string,
  allowSeasonCanonicalization = false,
): boolean {
  let currentUrl: URL
  let targetUrl: URL
  try {
    currentUrl = new URL(current)
    targetUrl = new URL(target, currentUrl)
  } catch {
    return false
  }
  if (currentUrl.origin !== targetUrl.origin) return false
  const from = drawerPlayableId(currentUrl.href)
  const to = drawerPlayableId(targetUrl.href)
  if (!from && !to) return false
  // list/festival 可能先进入无 ID shell，再在 query 中补出真正播放对象。
  // 从“不可识别”到“可识别”（或反向）不能安全当作同一内容。
  if (!from || !to) return true
  if (from === to) {
    // 同一 BV 的不同分 P 也会换媒体/MSE；缺省 p 与 p=1 视为同一入口，其余变化整页重建。
    if (from.startsWith('video:')) {
      const fromPart = currentUrl.searchParams.get('p') || '1'
      const toPart = targetUrl.searchParams.get('p') || '1'
      if (fromPart !== toPart) return true
      const routeFamily = (url: URL): string => {
        if (/^\/video\//i.test(url.pathname)) return 'video'
        if (/^\/list\//i.test(url.pathname)) return 'list'
        if (/^\/festival\//i.test(url.pathname)) return 'festival'
        return 'other'
      }
      // 同 BVID 从 list/festival shell 切到普通播放页仍会重建播放器，不复用 SPA。
      if (routeFamily(currentUrl) !== routeFamily(targetUrl)) return true
    }
    return false
  }
  if (allowSeasonCanonicalization) {
    const canonicalizedBangumi = from.startsWith('bangumi:ss') && to.startsWith('bangumi:ep')
    const canonicalizedCheese = from.startsWith('cheese:ss') && to.startsWith('cheese:ep')
    if (canonicalizedBangumi || canonicalizedCheese) return false
  }
  return true
}

/** History API 不能跨 origin 改地址栏；同源时返回去掉抽屉标记的公开 URL。 */
export function drawerDisplayUrl(target: string, currentHref: string): string | null {
  try {
    const current = new URL(currentHref)
    const next = new URL(target, current)
    if (next.origin !== current.origin) return null
    if (drawerMark(next.hash)) next.hash = ''
    return next.href
  } catch {
    return null
  }
}

export function withDrawerRoute(state: unknown, route: DrawerHistoryRoute): Record<string, unknown> {
  const base = state && typeof state === 'object' && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {}
  const out = { ...base, [DRAWER_HISTORY_KEY]: route }
  delete out[DRAWER_ORIGIN_KEY]
  return out
}

export function withDrawerOrigin(state: unknown, token: string): Record<string, unknown> {
  const base = state && typeof state === 'object' && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {}
  const out = { ...base, [DRAWER_ORIGIN_KEY]: token }
  delete out[DRAWER_HISTORY_KEY]
  return out
}

export function readDrawerOrigin(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null
  const token = (state as Record<string, unknown>)[DRAWER_ORIGIN_KEY]
  return typeof token === 'string' ? token : null
}

export function readDrawerRoute(state: unknown): DrawerHistoryRoute | null {
  if (!state || typeof state !== 'object') return null
  const route = (state as Record<string, unknown>)[DRAWER_HISTORY_KEY]
  if (!route || typeof route !== 'object') return null
  const r = route as Record<string, unknown>
  if (
    typeof r.token !== 'string' || !r.token || typeof r.url !== 'string' || typeof r.cover !== 'string'
    || typeof r.webFull !== 'boolean' || typeof r.immersive !== 'boolean'
  ) return null
  return r as unknown as DrawerHistoryRoute
}
