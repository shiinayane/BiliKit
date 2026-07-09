import { NS } from './shared'

/**
 * 右下角悬浮按钮组：推荐源切换（上，手机=App / 电脑=Web，hover 展开竖向胶囊选择）
 *  + 返回顶部（滚动后淡入）+ 刷新内容（常驻）。只挂一次。
 * 返回顶部的显隐用 IntersectionObserver 盯一个顶部标记（零 scroll 监听成本）。
 * 刷新交给外部回调（feed 的 refreshFeed）；源切换交给外部回调（feed 的 switchSource）。
 */
type Source = 'app' | 'web'

let controls: HTMLElement | null = null
let markerEl: HTMLElement | null = null
let markerIo: IntersectionObserver | null = null

// 手机=App 推荐、电脑=Web 推荐（描边风格，与其它 FAB 图标一致）
const PHONE_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="10.5" y1="18" x2="13.5" y2="18"/></svg>'
const PC_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="16.5" x2="12" y2="21"/></svg>'
const REFRESH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>'
const TOP_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'

// 推荐源切换器：默认只显当前源图标；hover（或触屏点一下）展成竖向胶囊列出两项，点一项即切换。
function buildSourceSwitcher(initial: Source, onSwitch: (s: Source) => void): HTMLElement {
  let cur = initial
  const wrap = document.createElement('div')
  wrap.className = `${NS}-src`
  const iconOf = (s: Source) => (s === 'app' ? PHONE_SVG : PC_SVG)
  wrap.innerHTML =
    `<button class="${NS}-src-cur" type="button" title="推荐来源" aria-label="切换推荐来源"></button>` +
    `<div class="${NS}-src-pop">` +
    `<button class="${NS}-src-opt" data-src="app" type="button" title="App 推荐" aria-label="App 推荐">${PHONE_SVG}</button>` +
    `<button class="${NS}-src-opt" data-src="web" type="button" title="网页推荐" aria-label="网页推荐">${PC_SVG}</button>` +
    `</div>`
  const curBtn = wrap.querySelector(`.${NS}-src-cur`) as HTMLElement
  const paint = (s: Source): void => {
    cur = s
    curBtn.innerHTML = iconOf(s)
    wrap.querySelectorAll(`.${NS}-src-opt`).forEach((o) => o.classList.toggle('on', (o as HTMLElement).dataset.src === s))
  }
  paint(cur)
  // 触屏无 hover：点当前按钮展开/收起胶囊（桌面走 CSS :hover 兜底）
  curBtn.addEventListener('click', (e) => { e.stopPropagation(); wrap.classList.toggle('open') })
  wrap.querySelectorAll(`.${NS}-src-opt`).forEach((o) => o.addEventListener('click', (e) => {
    e.stopPropagation()
    const s = (o as HTMLElement).dataset.src as Source
    wrap.classList.remove('open')
    if (s === cur) return
    paint(s)
    onSwitch(s) // feed.switchSource：换源 + 立即刷新（与顶部 Tab 旧逻辑一致）
  }))
  return wrap
}

export function mountControls(
  onRefresh: (btn: HTMLElement) => void,
  srcCtl?: { initial: Source; onSwitch: (s: Source) => void },
): void {
  if (controls && controls.isConnected) return
  // 走到这说明上一份 fab 已不在（SPA 重入）——清掉残留的 fab / marker / observer，防止累积泄漏
  controls?.remove()
  markerEl?.remove()
  markerIo?.disconnect()
  const fab = document.createElement('div')
  fab.className = `${NS}-fab`
  // 顺序（自上而下）：推荐源切换 → 返回顶部（滚动后现）→ 刷新（常驻）。切换在最上，hover 弹胶囊向上展开、不压其它键。
  fab.innerHTML =
    `<button class="bk-top" title="返回顶部" aria-label="返回顶部">${TOP_SVG}</button>` +
    `<button class="bk-refresh" title="刷新内容" aria-label="刷新内容">${REFRESH_SVG}</button>`
  const refreshBtn = fab.querySelector('.bk-refresh') as HTMLElement
  refreshBtn.addEventListener('click', () => onRefresh(refreshBtn))
  ;(fab.querySelector('.bk-top') as HTMLElement).addEventListener('click', () =>
    window.scrollTo({ top: 0, behavior: 'smooth' }),
  )
  if (srcCtl) fab.insertBefore(buildSourceSwitcher(srcCtl.initial, srcCtl.onSwitch), fab.firstChild)
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
