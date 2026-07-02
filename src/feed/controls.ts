import { NS } from './shared'

/**
 * 右下角悬浮按钮：返回顶部（上，滚动后淡入）+ 刷新内容（下，常驻）。只挂一次。
 * 返回顶部的显隐用 IntersectionObserver 盯一个顶部标记（零 scroll 监听成本）。
 * 刷新交给外部回调（feed 的 refreshFeed），按钮引用回传以便转圈。
 */
let controls: HTMLElement | null = null
let markerEl: HTMLElement | null = null
let markerIo: IntersectionObserver | null = null

export function mountControls(onRefresh: (btn: HTMLElement) => void): void {
  if (controls && controls.isConnected) return
  // 走到这说明上一份 fab 已不在（SPA 重入）——清掉残留的 fab / marker / observer，防止累积泄漏
  controls?.remove()
  markerEl?.remove()
  markerIo?.disconnect()
  const REFRESH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>'
  const TOP_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
  const fab = document.createElement('div')
  fab.className = `${NS}-fab`
  // 返回顶部在上、刷新在下：刷新常驻，与齿轮左右对齐更整齐
  fab.innerHTML =
    `<button class="bk-top" title="返回顶部" aria-label="返回顶部">${TOP_SVG}</button>` +
    `<button class="bk-refresh" title="刷新内容" aria-label="刷新内容">${REFRESH_SVG}</button>`
  const refreshBtn = fab.querySelector('.bk-refresh') as HTMLElement
  refreshBtn.addEventListener('click', () => onRefresh(refreshBtn))
  ;(fab.querySelector('.bk-top') as HTMLElement).addEventListener('click', () =>
    window.scrollTo({ top: 0, behavior: 'smooth' }),
  )
  document.body.appendChild(fab)
  controls = fab

  // 顶部标记放在首屏折叠线下方（400px）：位于视口内 → 处于顶部（藏按钮）；
  // 滚过它离开视口 → 加 .scrolled 淡入「返回顶部」。零 scroll 监听。
  const marker = document.createElement('div')
  marker.style.cssText = 'position:absolute;top:400px;left:0;width:1px;height:1px;pointer-events:none;'
  document.body.appendChild(marker)
  markerEl = marker
  markerIo = new IntersectionObserver((es) => fab.classList.toggle('scrolled', !es[0].isIntersecting))
  markerIo.observe(marker)
}
