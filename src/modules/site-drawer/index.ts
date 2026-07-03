import { openDrawer, preconnect } from '../../core/drawer'
import { get } from '../../core/settings'

/**
 * 全站抽屉：在任意 B 站页面（首页 / 搜索 / 收藏 / 历史 / 稍后看 / 别人空间 / 动态…）点视频，
 * 按「打开方式」(feed.openMode) 打开——抽屉 / 网页全屏抽屉 / 新标签 / 当前页(不拦)。不跳走、不丢当前列表。
 * 做法：document 上捕获阶段委托点击 → 命中视频链接就接管（复用 Core 抽屉）；非视频/修饰键点击一律放行。
 * 无独立开关，直接由「打开方式」驱动（当前页=不拦）；首页 Feed 卡片也走这里（卡片带 data-bvid）。
 */
function isVideoUrl(u: string): boolean {
  try {
    const url = new URL(u, location.href)
    if (!/(^|\.)bilibili\.com$/.test(url.hostname)) return false
    // 收紧：av 后须跟数字、BV 后须跟字母数字、ep/ss 后须跟数字——免得误吃 /video/average 之类
    return /^\/video\/(BV[0-9A-Za-z]+|av\d+)/i.test(url.pathname) || /^\/bangumi\/play\/(ep|ss)\d+/i.test(url.pathname)
  } catch { return false }
}

// 从点击目标解析出「要打开的视频 URL(+可选封面)」；非视频 / 需放行 → null
function resolve(target: HTMLElement): { url: string; cover: string } | null {
  const pick = (root: Element, url: string) => {
    const img = root.querySelector('img') as HTMLImageElement | null
    return { url, cover: (img && (img.currentSrc || img.src)) || '' }
  }
  // 1) 原生 <a> 视频链接 → 接管。非视频 <a>（UP 空间/分区/合集…）不在此 return，继续看是否落在 data-bvid 卡片上
  //    （兜住「非视频 anchor 包着 data-bvid 卡片」的边角；当前标记结构不会触发，但更稳）
  const a = target.closest('a[href]') as HTMLAnchorElement | null
  if (a && isVideoUrl(a.href)) return pick(a, a.href.split('#')[0])
  // 2) Feed 卡片（div[data-bvid]）：排除头像 / UP 名区域（那些交给 Feed 自己进空间）
  const card = target.closest('[data-bvid]') as HTMLElement | null
  if (card && card.dataset.bvid && !target.closest('.bk-feed-face, .bk-feed-up')) {
    return pick(card, `https://www.bilibili.com/video/${card.dataset.bvid}`)
  }
  return null
}

export function installSiteDrawer(): void {
  if ((window as any).__BILIKIT_SITE_DRAWER__) return
  if (window.top !== window.self) return // 抽屉 / 嵌入 iframe 内不拦（让其内部点击照常导航）
  ;(window as any).__BILIKIT_SITE_DRAWER__ = true

  document.addEventListener('click', (e) => {
    const mode = get<string>('feed.openMode', 'drawer')
    if (mode === 'current') return // 当前页 = 原生行为，不拦
    // 修饰键 / 中键 / 已被处理 → 放行（用户想要新标签 / 站点已接管）
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const hit = resolve(e.target as HTMLElement)
    if (!hit) return
    e.preventDefault()
    e.stopImmediatePropagation() // 抢在站点 SPA 路由之前完全接管这次点击，避免底层又导航一遍
    if (mode === 'newtab') { window.open(hit.url, '_blank', 'noopener'); return }
    const web = mode === 'drawer-web'
    openDrawer(hit.url, hit.cover, web, web && get<boolean>('feed.drawerImmersive', true))
  }, true) // capture：先于站点自身 handler

  // 悬停视频链接预连接（省点开握手）：drawer 内部 12s 节流
  document.addEventListener('mouseover', (e) => {
    const mode = get<string>('feed.openMode', 'drawer')
    if (mode !== 'drawer' && mode !== 'drawer-web') return
    if (resolve(e.target as HTMLElement)) preconnect()
  }, true)
}
