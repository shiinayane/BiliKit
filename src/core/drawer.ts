/**
 * 底部上滑抽屉（Core 版，全站可用）：同源 iframe 里打开视频页，从下往上滑出、顶部留一条缝。
 * 由「全站抽屉」模块在任意 B 站页面拦截视频点击后调用（原先只在 Feed 首页用，现上移到 Core、全站统一）。
 * iframe URL 打 #bk-drawer(-web) 标记，由 iframe 内的 Core 隐顶栏+去广告(+网页全屏)（见 entry-core）。
 * 加载遮罩（封面模糊铺底 + spinner）盖住打开瞬间黑→白闪，揭幕由 Core 报「首帧就绪 / 已铺满」触发。
 * 样式自带（注入一次），不依赖 Feed。
 */
const NS = 'bk' // Core 抽屉类名前缀（与 Feed 的 bk-feed 区隔）
const NEWTAB_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const MARK = '#bk-drawer' // iframe 标记：Core 识别后隐顶栏+去广告
const MARK_WEB = '#bk-drawer-web' // 同上 + Core 再点一次「网页全屏」，播放器铺满抽屉（沉浸模式）

const CSS = `
.${NS}-dctrls button{ width:40px; height:40px; border-radius:50%; padding:0; display:flex; align-items:center; justify-content:center; border:1px solid var(--line_regular,#e3e5e7); background:var(--bg1,#fff); color:var(--text2,#61666d); cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,.12); transition:color .16s ease, transform .16s ease, box-shadow .16s ease, opacity .18s ease; }
.${NS}-dctrls button:hover{ color:var(--brand_blue,#00aeec); transform:translateY(-2px); box-shadow:0 5px 16px rgba(0,0,0,.2); }
.${NS}-dctrls button:active{ transform:scale(.94); }
@keyframes bk-dspin{ to{ transform:rotate(360deg); } }
.${NS}-dmask{ position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .3s ease; }
.${NS}-dmask.on{ opacity:1; pointer-events:auto; }
.${NS}-drawer{ position:fixed; left:0; right:0; bottom:0; height:calc(100% - 64px); z-index:100001; display:flex; flex-direction:column; background:var(--bg1,#fff); border-radius:14px 14px 0 0; box-shadow:0 -8px 40px rgba(0,0,0,.35); transform:translateY(100%); transition:transform .32s cubic-bezier(.32,.72,0,1); overflow:hidden; }
.${NS}-drawer.on{ transform:translateY(0); }
.${NS}-dframe{ flex:1; width:100%; border:0; display:block; }
.${NS}-dload{ position:absolute; inset:0; z-index:1; display:flex; align-items:center; justify-content:center; background:#18191c; opacity:0; pointer-events:none; transition:opacity .3s ease; }
.${NS}-drawer.loading .${NS}-dload{ opacity:1; }
.${NS}-dload-cover{ position:absolute; inset:0; background-size:cover; background-position:center; filter:blur(24px) brightness(.6); transform:scale(1.1); }
.${NS}-dspin{ position:relative; width:42px; height:42px; border:3px solid rgba(255,255,255,.2); border-top-color:var(--brand_blue,#00aeec); border-radius:50%; animation:bk-dspin .8s linear infinite; }
@media (prefers-color-scheme: light){ .${NS}-dload{ background:#f4f4f5; } .${NS}-dspin{ border-color:rgba(0,0,0,.12); border-top-color:var(--brand_blue,#00aeec); } }
.${NS}-dctrls{ position:fixed; top:14px; right:18px; z-index:100002; display:flex; gap:10px; opacity:0; pointer-events:none; transition:opacity .3s ease; }
.${NS}-dctrls.on{ opacity:1; pointer-events:auto; }
`

let styled = false
let mask: HTMLElement | null = null
let panel: HTMLElement | null = null
let frame: HTMLIFrameElement | null = null
let ctrls: HTMLElement | null = null
let loadCover: HTMLElement | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let loadTimer: ReturnType<typeof setTimeout> | null = null
let curUrl = ''
let curWebFull = false // 本次打开是否网页全屏模式
let curImmersive = false // 网页全屏 + 沉浸：遮罩留到「铺满 且 已开播」才撤（藏过渡）
let gotReady = false // Core 报「视频首帧已就绪」（早于真正开播/出声）
let gotWebfull = false // Core 报「网页全屏已铺满」

// 揭幕（撤加载遮罩）时机：普通抽屉/非沉浸 → 首帧一就绪就揭（早于出声，揭幕即见首帧、声音不先出）；
// 网页全屏 + 沉浸 → 还要等「已铺满」，避免看到「普通页→切满」过渡。信号均由 iframe 内 Core postMessage。
function tryReveal(): void {
  if (!gotReady) return
  if (curWebFull && curImmersive && !gotWebfull) return
  setLoading(false)
  // 把键盘焦点路由进 iframe——抽屉由父页点击打开，焦点本留在父页，keydown 到不了 iframe，
  // 空格等播放器快捷键失效（还会滚动 iframe 内的视频页）。contentWindow.focus() 跨源也允许。
  // iframe 内 Core 再把焦点落到播放器（见 entry-core），双管齐下。
  try { frameWin()?.focus() } catch { /* 忽略 */ }
}

function frameWin(): Window | null {
  try { return frame?.contentWindow || null } catch { return null }
}

function setLoading(on: boolean): void {
  panel?.classList.toggle('loading', on)
  if (loadTimer) { clearTimeout(loadTimer); loadTimer = null }
  if (on) loadTimer = setTimeout(() => setLoading(false), 6000) // 兜底：信号迟迟不来也撤遮罩
}

function ensureDom(): void {
  if (mask) return
  if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = CSS; (document.head || document.documentElement).appendChild(s) }
  mask = document.createElement('div')
  mask.className = `${NS}-dmask`
  panel = document.createElement('div')
  panel.className = `${NS}-drawer`
  frame = document.createElement('iframe')
  frame.className = `${NS}-dframe`
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write'
  frame.allowFullscreen = true
  // sandbox：不含 allow-top-navigation → 禁止被嵌视频页把顶层窗口导航走（frame-busting）。须在设 src 前就位。
  frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals allow-downloads')
  // Core 在抽屉 iframe 内的两个揭幕信号：视频首帧就绪 / 网页全屏已铺满。（揭幕由此触发，setLoading 自带超时兜底）
  window.addEventListener('message', (e) => {
    if (e.source !== frameWin()) return
    if (e.data === 'bk-drawer-ready') { gotReady = true; tryReveal() }
    else if (e.data === 'bk-drawer-webfull') { gotWebfull = true; tryReveal() }
  })
  panel.appendChild(frame)
  const load = document.createElement('div')
  load.className = `${NS}-dload`
  loadCover = document.createElement('div')
  loadCover.className = `${NS}-dload-cover`
  const spinner = document.createElement('div')
  spinner.className = `${NS}-dspin`
  load.append(loadCover, spinner)
  panel.appendChild(load)
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
  mask.addEventListener('click', closeDrawer) // 点顶部缝/遮罩关闭（另有关闭按钮 / Esc）
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel?.classList.contains('on')) closeDrawer() })
  document.body.append(mask, panel, ctrls)
}

export function openDrawer(url: string, cover = '', webFull = false, immersive = false): void {
  ensureDom()
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  curUrl = url
  curWebFull = webFull
  curImmersive = immersive
  const marked = url.split('#')[0] + (webFull ? MARK_WEB : MARK) // 去掉原 URL 的 hash，换上抽屉标记（否则 Core 认不到、不隐顶栏/不发揭幕信号）
  if (frame!.src !== marked) {
    // 换视频（或已被 about:blank 清过）：重新加载 → 显遮罩、等 iframe 内 Core 发「首帧就绪」再揭幕
    gotReady = false
    gotWebfull = false
    if (loadCover) loadCover.style.backgroundImage = cover ? `url("${cover}")` : ''
    setLoading(true)
    frame!.src = marked
  } else {
    // 同一视频、iframe 未卸载（快速重开，仍在播）：已加载好，直接揭幕、不显遮罩——否则不重载就等不到新信号，会卡满 6s
    setLoading(false)
  }
  document.documentElement.style.overflow = 'hidden' // 锁底层滚动
  requestAnimationFrame(() => { mask!.classList.add('on'); panel!.classList.add('on'); ctrls!.classList.add('on') })
}

export function closeDrawer(): void {
  if (!panel || !mask || !ctrls) return
  mask.classList.remove('on')
  panel.classList.remove('on')
  ctrls.classList.remove('on')
  setLoading(false)
  document.documentElement.style.overflow = ''
  closeTimer = setTimeout(() => { if (frame && !panel?.classList.contains('on')) frame.src = 'about:blank' }, 340)
}

/**
 * 悬停预连接：hover 视频链接时预连 B站静态/接口主机，点开省握手延迟。12s 节流。
 * 不含 data.bilibili.com：纯埋点/日志域，播放用不到，预连纯属浪费。
 */
const PC_HOSTS = ['https://api.bilibili.com', 'https://s1.hdslb.com', 'https://i0.hdslb.com', 'https://i1.hdslb.com', 'https://i2.hdslb.com']
const PC_WINDOW = 12000
let lastPc = -Infinity
let pcLinks: HTMLElement[] = []
export function preconnect(): void {
  const now = performance.now()
  if (now - lastPc < PC_WINDOW) return
  lastPc = now
  pcLinks.forEach((l) => l.remove())
  pcLinks = PC_HOSTS.map((href) => {
    const l = document.createElement('link')
    l.rel = 'preconnect'
    l.href = href
    document.head.appendChild(l)
    return l
  })
}
