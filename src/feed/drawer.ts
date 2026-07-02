import { NS } from './shared'

/**
 * 底部上滑抽屉：同源 iframe 里打开视频页，从下往上滑出、顶部留一条缝(点缝=点遮罩关闭)。
 * 关闭 / 新标签页 是顶部缝里的独立浮动按钮（无条带、无手势）。
 * iframe URL 打 #bk-drawer 标记，由 iframe 内运行的 Core 隐顶栏+去广告（见 entry-core）。
 * 加载遮罩（封面模糊铺底 + spinner）盖住打开瞬间的黑→白闪；悬停预连接省握手延迟——均学原 float。
 */
const NEWTAB_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const MARK = '#bk-drawer' // iframe 标记：Core 识别后隐顶栏+去广告

let mask: HTMLElement | null = null
let panel: HTMLElement | null = null
let frame: HTMLIFrameElement | null = null
let ctrls: HTMLElement | null = null
let loadCover: HTMLElement | null = null
let dhint: HTMLElement | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let loadTimer: ReturnType<typeof setTimeout> | null = null
let curUrl = ''

// 滚动关闭手势：仅当「本次滚动手势一开始就已在顶部」时武装——继续上滚（两指下滑/滚轮上滚）→ 抽屉下移，
// 滚动停(松手)过阈值即关、否则回弹。关键：从评论快速滚回顶的手势起始不在顶部，其动量过冲不算数，杜绝误触。
// over iframe 的滚动需挂到其 contentWindow 才抓得到。
const GESTURE_GAP = 200 // ms：无 wheel 超过此值 → 视为新手势（重新判定起始是否在顶）
const DEAD = 20 // 死区：前 20px 原始上滚不响应
const DAMP = 0.5 // 阻尼
const PULL_CLOSE = 90 // 阻尼后位移超过此值 → 关（武装后累计上滚约 200px 即可）
let raw = 0
let pull = 0
let lastWheelAt = 0
let armed = false // 本手势是否武装（起始就在顶部）
let wheelTimer: ReturnType<typeof setTimeout> | null = null

function frameWin(): Window | null {
  try { return frame?.contentWindow || null } catch { return null }
}

function snapBack(): void {
  raw = 0
  pull = 0
  if (wheelTimer) { clearTimeout(wheelTimer); wheelTimer = null }
  if (panel) { panel.style.transition = ''; panel.style.transform = '' } // 交回 CSS .on → 回弹到 0
  dhint?.classList.remove('on')
}

function onWheel(e: WheelEvent): void {
  if (!panel || !dhint || !panel.classList.contains('on')) return
  const now = performance.now()
  const w = frameWin()
  const atTop = w ? (w.scrollY || 0) <= 0 : true
  if (now - lastWheelAt > GESTURE_GAP) armed = atTop // 新手势：记录起始是否已在顶部
  lastWheelAt = now
  // 只有「本手势起始在顶部 且 当前仍在顶部 且 上滚」才是关闭手势；否则正常翻页 / 动量过冲，重置
  if (!armed || !atTop || e.deltaY >= 0) { if (raw > 0) snapBack(); return }
  raw += -e.deltaY
  pull = Math.max(0, raw - DEAD) * DAMP // 过死区才开始位移
  if (wheelTimer) clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => { if (pull > PULL_CLOSE) closeDrawer(); else snapBack() }, 180) // 滚动停 → 决定
  if (pull <= 0) return // 仍在死区：不动、不提示
  panel.style.transition = 'none'
  panel.style.transform = `translateY(${Math.min(pull, 340)}px)`
  const willClose = pull > PULL_CLOSE
  dhint.classList.add('on')
  dhint.textContent = willClose ? '松开关闭' : '下拉关闭'
}

function setLoading(on: boolean): void {
  panel?.classList.toggle('loading', on)
  if (loadTimer) { clearTimeout(loadTimer); loadTimer = null }
  if (on) loadTimer = setTimeout(() => setLoading(false), 6000) // 兜底：iframe load 迟迟不来也撤遮罩
}

function ensureDom(): void {
  if (mask) return
  mask = document.createElement('div')
  mask.className = `${NS}-dmask`
  panel = document.createElement('div')
  panel.className = `${NS}-drawer`
  frame = document.createElement('iframe')
  frame.className = `${NS}-dframe`
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write'
  frame.allowFullscreen = true
  // sandbox 关键：不含 allow-top-navigation → 禁止被嵌视频页把顶层窗口导航走（frame-busting → 变全屏页）。
  // 其余能力齐全，播放器/登录/同源请求照常。sandbox 须在设 src 前就位。
  frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals allow-downloads')
  frame.addEventListener('load', () => {
    setLoading(false) // 加载完（含内部跳转）撤遮罩
    // 视频区上的滚动落在 iframe 上，把关闭手势的 wheel 监听挂到同源 contentWindow 才抓得到
    try { frame!.contentWindow?.addEventListener('wheel', onWheel, { passive: true }) } catch { /* 取不到子窗口就算了 */ }
  })
  panel.appendChild(frame)
  // 加载遮罩：封面模糊铺底 + spinner，盖住打开瞬间黑→白闪
  const load = document.createElement('div')
  load.className = `${NS}-dload`
  loadCover = document.createElement('div')
  loadCover.className = `${NS}-dload-cover`
  const spinner = document.createElement('div')
  spinner.className = `${NS}-dspin`
  load.append(loadCover, spinner)
  panel.appendChild(load)
  // 独立浮动按钮（在顶部缝里，不占条带）
  ctrls = document.createElement('div')
  ctrls.className = `${NS}-dctrls`
  ctrls.innerHTML =
    `<button class="bk-newtab" title="在新标签页打开" aria-label="在新标签页打开">${NEWTAB_SVG}</button>` +
    `<button class="bk-close" title="关闭" aria-label="关闭">${CLOSE_SVG}</button>`
  ;(ctrls.querySelector('.bk-newtab') as HTMLElement).addEventListener('click', () => {
    if (curUrl) window.open(curUrl, '_blank', 'noopener')
    closeDrawer()
  })
  ;(ctrls.querySelector('.bk-close') as HTMLElement).addEventListener('click', closeDrawer)
  // 下拉提示：固定在顶部缝里，滚动关闭手势时淡入（下拉关闭 / 松开关闭）
  dhint = document.createElement('div')
  dhint.className = `${NS}-dhint`
  dhint.textContent = '下拉关闭'
  mask.addEventListener('click', closeDrawer) // 点顶部缝/遮罩关闭
  mask.addEventListener('wheel', onWheel, { passive: true }) // 在顶部缝上滚也能触发关闭
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel?.classList.contains('on')) closeDrawer() })
  document.body.append(mask, panel, ctrls, dhint)
}

export function openDrawer(url: string, cover = ''): void {
  ensureDom()
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  curUrl = url // 新标签按钮用干净 URL
  if (loadCover) loadCover.style.backgroundImage = cover ? `url("${cover}")` : ''
  setLoading(true) // 显示加载遮罩，iframe load 后自动撤下
  const marked = url.includes('#') ? url : url + MARK
  if (frame!.src !== marked) frame!.src = marked
  document.documentElement.style.overflow = 'hidden' // 锁底层滚动
  requestAnimationFrame(() => { mask!.classList.add('on'); panel!.classList.add('on'); ctrls!.classList.add('on') })
}

export function closeDrawer(): void {
  if (!panel || !mask || !ctrls) return
  // 复位滚动手势的临时内联样式，让 .on 移除能正常滑出（否则内联 translateY 会卡住）
  raw = 0
  pull = 0
  if (wheelTimer) { clearTimeout(wheelTimer); wheelTimer = null }
  panel.style.transition = ''
  panel.style.transform = ''
  dhint?.classList.remove('on')
  mask.classList.remove('on')
  panel.classList.remove('on')
  ctrls.classList.remove('on')
  setLoading(false)
  document.documentElement.style.overflow = ''
  closeTimer = setTimeout(() => { if (frame && !panel?.classList.contains('on')) frame.src = 'about:blank' }, 340)
}

/**
 * 悬停预连接：hover 视频卡时预连 B站静态/接口主机，点开省去握手延迟。12s 节流（连接空闲约此量级被回收）。
 * 任意时刻最多一批 preconnect 节点，避免 <head> 累积。
 */
const PC_HOSTS = ['https://api.bilibili.com', 'https://s1.hdslb.com', 'https://i0.hdslb.com', 'https://i1.hdslb.com', 'https://i2.hdslb.com', 'https://data.bilibili.com']
const PC_WINDOW = 12000
let lastPc = -Infinity
let pcLinks: HTMLElement[] = []
export function preconnect(): void {
  const now = performance.now()
  if (now - lastPc < PC_WINDOW) return // 连接仍热，跳过
  lastPc = now
  pcLinks.forEach((l) => l.remove())
  pcLinks = PC_HOSTS.map((href) => {
    const l = document.createElement('link')
    l.rel = 'preconnect'
    l.href = href // 不设 crossOrigin：封面/脚本多为 no-cors，模式需与真实请求一致，否则连接失配弃用
    document.head.appendChild(l)
    return l
  })
}
