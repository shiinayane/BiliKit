export const DRAWER_HISTORY_KEY = '__bilikitDrawer'
export const DRAWER_ORIGIN_KEY = '__bilikitDrawerOrigin'
export const DRAWER_FRAME_PREFIX = 'bilikit-drawer:'
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
