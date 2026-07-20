import {
  DRAWER_MARK as MARK,
  DRAWER_WEB_MARK as MARK_WEB,
  canReuseDrawerDocument,
  drawerDisplayUrl,
  drawerFrameName,
  readDrawerOrigin,
  readDrawerRoute,
  safeDrawerVideoUrl,
  withDrawerOrigin,
  withDrawerRoute,
  type DrawerHistoryRoute,
} from './drawer-history'

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
const CSS = `
/* 按钮体**跟随页面主题**（--bg1/--text2）：浅色页浅按钮、深色页深按钮。
   凸显靠**阴影随主题反相**：浅色→黑色投影压出立体，深色→白色辉光(halo)把深按钮从暗遮罩里托起来（见 @media dark）。 */
.${NS}-dctrls button{ width:40px; height:40px; border-radius:50%; padding:0; display:flex; align-items:center; justify-content:center; border:1px solid var(--line_regular,#e3e5e7); background:var(--bg1,#fff); color:var(--text2,#61666d); cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.5); transition:color .16s ease, transform .16s ease, box-shadow .16s ease, opacity .18s ease; }
.${NS}-dctrls button:hover{ color:var(--brand_blue,#00aeec); transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.6); }
.${NS}-dctrls button:active{ transform:scale(.94); }
/* 深色模式：按钮体仍跟主题（深底），阴影反相为白色辉光，把深按钮从暗遮罩里托起来 */
@media (prefers-color-scheme: dark){ .${NS}-dctrls button{ box-shadow:0 0 8px rgba(255,255,255,.45); } .${NS}-dctrls button:hover{ box-shadow:0 0 12px rgba(255,255,255,.6); } }
@keyframes bk-dspin{ to{ transform:rotate(360deg); } }
.${NS}-dmask{ position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .3s ease; }
.${NS}-dmask.on{ opacity:1; pointer-events:auto; }
.${NS}-drawer{ position:fixed; left:0; right:0; bottom:0; height:calc(100% - 64px); z-index:100001; display:flex; flex-direction:column; background:var(--bg1,#fff); border-radius:14px 14px 0 0; box-shadow:0 -8px 40px rgba(0,0,0,.35); transform:translateY(100%); transition:transform .32s cubic-bezier(.32,.72,0,1); overflow:hidden; }
.${NS}-drawer.on{ transform:translateY(0); }
.${NS}-drawer.parked{ visibility:hidden; }
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
let drawerOpen = false // 同步真源；不能只看过渡中的 .on class（iframe load 可能撞在首个 rAF 前）
let curUrl = ''
let curWebFull = false // 本次打开是否网页全屏模式
let curImmersive = false // 网页全屏 + 沉浸：遮罩留到「铺满 且 已开播」才撤（藏过渡）
let gotReady = false // Core 报「视频首帧已就绪」（早于真正开播/出声）
let gotWebfull = false // Core 报「网页全屏已铺满」
let historyActive = false // 当前顶层 history entry 是本次抽屉条目
let historyOwned = false // 本文档曾成功 push 抽屉条目（Back 后该条目仍在 Forward 方向）
let historyClosing = false
let historyOriginUrl = ''
let historyOriginState: unknown = null
let activeRoute: DrawerHistoryRoute | null = null
let historyCloseFallback: ReturnType<typeof setTimeout> | null = null
let pendingOpen: Omit<DrawerHistoryRoute, 'token'> | null = null
let frameToken = '' // 当前 iframe Document 的 nonce；每次整页 replace 都更新，拒绝旧 Document 的迟到消息
let frameRouteToken = '' // 顶层抽屉 history 会话 token；跨 Document 保持，用于 Back/Forward 归属
let framePublicUrl = '' // iframe 当前公开视频 URL；子页内部导航时随 location 消息更新
let frameWebFull = false
let frameReady = false
let pendingFrameReplace: {
  route: DrawerHistoryRoute
  marked: string
  phase: 'suspend' | 'navigate'
  nextToken?: string
  accepted?: boolean
  timer: ReturnType<typeof setTimeout> | null
} | null = null
let queuedFrameReplace: { route: DrawerHistoryRoute; marked: string } | null = null
let suspendRetryTimer: ReturnType<typeof setInterval> | null = null
const FRAME_LANDING_TIMEOUT = 15_000

// 用 userscript document-start 时捕获的原生方法改地址栏，不触发 B 站后续包装的 SPA pushState 监听。
const nativePushState = History.prototype.pushState
const nativeReplaceState = History.prototype.replaceState

function newHistoryToken(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }
}

function displayUrlFor(route: DrawerHistoryRoute): string {
  return drawerDisplayUrl(route.url, location.href) || location.href
}

function replaceDrawerHistory(route: DrawerHistoryRoute): boolean {
  // 同源页直接显示视频 URL；search/space 等跨子域时 History API 不允许换 origin，
  // 仍 push 一条同地址的虚拟路由，使浏览器后退/前进可关闭/重开抽屉。
  try {
    const state = withDrawerRoute(history.state, route)
    nativeReplaceState.call(history, state, '', displayUrlFor(route))
    activeRoute = route
    historyActive = true
    historyOwned = true
    return true
  } catch {
    return false
  }
}

function pushDrawerHistory(route: DrawerHistoryRoute): boolean {
  historyOriginUrl = location.href
  historyOriginState = history.state
  try {
    // origin 也打临时 token：程序关闭即使遇到额外 history 条目，也能一直退到确切锚点。
    nativeReplaceState.call(history, withDrawerOrigin(historyOriginState, route.token), '', historyOriginUrl)
    nativePushState.call(history, withDrawerRoute(historyOriginState, route), '', displayUrlFor(route))
    activeRoute = route
    historyActive = true
    historyOwned = true
    return true
  } catch {
    // Safari History API 限速等失败：恢复原 entry，抽屉仍可显示，但绝不冒充 owned entry 拦真实 Back。
    try { nativeReplaceState.call(history, historyOriginState, '', historyOriginUrl) } catch { /* ignore */ }
    historyActive = false
    historyOwned = false
    return false
  }
}

function syncDrawerHistory(url: string): void {
  // 不依赖 history.state：B 站顶层 SPA 会在抽屉打开后 replaceState，覆盖我们的自定义字段。
  if (!drawerOpen || historyClosing || !historyActive || !activeRoute) return
  const expectedOrigin = new URL(activeRoute.url, location.href).origin
  const publicUrl = safeDrawerVideoUrl(url, expectedOrigin)
  if (!publicUrl) return
  curUrl = publicUrl
  framePublicUrl = publicUrl
  replaceDrawerHistory({ ...activeRoute, url: publicUrl })
}

function finishHistoryClose(): void {
  if (historyCloseFallback) { clearTimeout(historyCloseFallback); historyCloseFallback = null }
  historyClosing = false
  historyActive = false
  // 当前已经由 Back 落在 origin entry；去掉临时 token，还原站点原 state。
  try { nativeReplaceState.call(history, historyOriginState, '', historyOriginUrl) } catch { /* ignore */ }
  const next = pendingOpen
  pendingOpen = null
  if (next) queueMicrotask(() => openDrawer(next.url, next.cover, next.webFull, next.immersive))
}

function consumeDrawerHistory(): void {
  if (!historyOwned || !historyActive || !activeRoute || historyClosing) return
  historyClosing = true
  // B 站可能 replaceState 覆盖 marker；退栈前补回，Forward 才仍可识别并重开。
  replaceDrawerHistory(activeRoute)
  try { history.back() } catch { finishHistoryClose(); return }
  // 极端浏览器未派发 popstate 时才降级为 replace；正常路径不会留下重复 origin 条目。
  historyCloseFallback = setTimeout(() => {
    if (!historyClosing) return
    historyOwned = false
    finishHistoryClose()
  }, 1200)
}

// 揭幕（撤加载遮罩）时机：普通抽屉/非沉浸 → 首帧一就绪就揭（早于出声，揭幕即见首帧、声音不先出）；
// 网页全屏 + 沉浸 → 还要等「已铺满」，避免看到「普通页→切满」过渡。信号均由 iframe 内 Core postMessage。
function tryReveal(): boolean {
  if (!drawerOpen) return false
  if (!gotReady) return false
  if (curWebFull && curImmersive && !gotWebfull) return false
  setLoading(false)
  // 把键盘焦点路由进 iframe——抽屉由父页点击打开，焦点本留在父页，keydown 到不了 iframe，空格等播放器
  // 快捷键失效（还会滚动 iframe 内视频页）。从 search/space 等子域打开时父页与 iframe(www) **跨源**，
  // WebKit 会忽略跨源的 `contentWindow.focus()`（故此前只有同源的首页生效、其它页失效）——先 focus()
  // iframe **元素**（父页操作自己的 DOM，跨源同样奏效，把键盘焦点送进 frame），再 contentWindow.focus() 兜同源。
  // iframe 内 Core 再把焦点具体落到播放器（见 entry-core），双管齐下。
  try { frame?.focus({ preventScroll: true }) } catch { /* 忽略 */ }
  try { frameWin()?.focus() } catch { /* 忽略 */ }
  return true
}

function frameWin(): Window | null {
  try { return frame?.contentWindow || null } catch { return null }
}

function postFrameCommand(
  type: 'bk-drawer-suspend' | 'bk-drawer-resume',
): void {
  if (!frame || !frameToken || !framePublicUrl) return
  let origin: string
  try { origin = new URL(framePublicUrl, location.href).origin } catch { return }
  try {
    frame.contentWindow?.postMessage({ type, token: frameToken }, origin)
  } catch { /* 子页正在导航时消息可丢；load/ready 处理会再补一次 suspend */ }
}

function stopSuspendRetries(): void {
  if (suspendRetryTimer) { clearInterval(suspendRetryTimer); suspendRetryTimer = null }
}

function suspendFrameWithRetry(): void {
  stopSuspendRetries()
  postFrameCommand('bk-drawer-suspend')
  let left = 12
  suspendRetryTimer = setInterval(() => {
    if (drawerOpen || --left <= 0) { stopSuspendRetries(); return }
    postFrameCommand('bk-drawer-suspend')
  }, 150)
}

function cancelPendingFrameReplace(): void {
  if (!pendingFrameReplace) return
  if (pendingFrameReplace.timer) clearTimeout(pendingFrameReplace.timer)
  pendingFrameReplace = null
}

function rebuildFrameDocument(route: DrawerHistoryRoute, marked: string): void {
  cancelPendingFrameReplace()
  queuedFrameReplace = null
  const previous = frame
  if (previous?.isConnected) previous.remove()
  // 异常恢复也是先移除再创建，DOM 中始终至多一个 iframe。新框架的首次 src
  // 属于初始导航，用来逃离无 Core 握手/错误页，不向原 browsing context 追加 joint history。
  frame = createFrame()
  if (loadCover) loadCover.style.backgroundImage = route.cover ? `url("${route.cover}")` : ''
  setLoading(true)
  finishFrameReplace(route, marked, true)
  panel!.insertBefore(frame, panel!.firstChild)
}

function armFrameLandingWatchdog(pending: NonNullable<typeof pendingFrameReplace>): void {
  if (pending.phase !== 'navigate') return
  if (pending.timer) clearTimeout(pending.timer)
  pending.timer = setTimeout(() => {
    if (pendingFrameReplace !== pending) return
    if (!drawerOpen) {
      // 隐藏期不为恢复而主动加载页面；下次展开时会重新启动 watchdog。
      pending.timer = null
      return
    }
    const fallback = queuedFrameReplace || { route: pending.route, marked: pending.marked }
    rebuildFrameDocument(fallback.route, fallback.marked)
  }, FRAME_LANDING_TIMEOUT)
}

function finishFrameReplace(route: DrawerHistoryRoute, marked: string, fresh: boolean, nextToken = newHistoryToken()): void {
  cancelPendingFrameReplace()
  frameRouteToken = route.token
  frameToken = nextToken
  framePublicUrl = route.url
  frameWebFull = route.webFull
  frameReady = false
  gotReady = false
  gotWebfull = false
  frame!.name = drawerFrameName({ token: frameToken, webFull: route.webFull })
  if (fresh) {
    frame!.src = marked
  }
}

/** location.replace 已被旧文档接受，但新 Document 还未必落地。切换鉴权 nonce，保留 pending 等首条新文档消息。 */
function acceptFrameReplace(pending: NonNullable<typeof pendingFrameReplace>): void {
  if (pending.phase !== 'navigate' || !pending.nextToken || pending.accepted) return
  pending.accepted = true
  frameRouteToken = pending.route.token
  frameToken = pending.nextToken
  framePublicUrl = pending.route.url
  frameWebFull = pending.route.webFull
  frameReady = false
  gotReady = false
  gotWebfull = false
  frame!.name = drawerFrameName({ token: frameToken, webFull: frameWebFull })
}

function recoverFrameReplace(route: DrawerHistoryRoute): void {
  if (pendingFrameReplace?.route !== route) return
  const failedPhase = pendingFrameReplace.phase
  cancelPendingFrameReplace()
  // 导航中文档连 suspend ack 都不能回，说明 bridge 尚未可用或已落到错误页。
  // 顺序重建单一 iframe，让用户最后选的目标仍能继续，而不是永久卡在 pending。
  if (failedPhase === 'suspend' && !frameReady && drawerOpen) {
    const fallback = queuedFrameReplace || { route, marked: route.url.split('#')[0] + (route.webFull ? MARK_WEB : MARK) }
    rebuildFrameDocument(fallback.route, fallback.marked)
    return
  }
  // 暂停或导航请求未被子页接受，地址栏不能停在未实际加载的目标上。
  if (activeRoute?.token === route.token && activeRoute.url === route.url && framePublicUrl) {
    const restored = { ...activeRoute, url: framePublicUrl, webFull: frameWebFull }
    activeRoute = restored
    curUrl = restored.url
    curWebFull = restored.webFull
    if (drawerOpen && historyActive && !historyClosing) replaceDrawerHistory(restored)
  }
  const queued = queuedFrameReplace
  queuedFrameReplace = null
  if (drawerOpen && queued) {
    replaceFrameDocument(queued.route, queued.marked, false)
    return
  }
  setLoading(false)
  if (drawerOpen && frameReady && tryReveal()) postFrameCommand('bk-drawer-resume')
}

function requestFrameReplace(route: DrawerHistoryRoute, marked: string): void {
  const previousToken = frameToken
  let previousOrigin: string
  try { previousOrigin = new URL(framePublicUrl, location.href).origin } catch { recoverFrameReplace(route); return }
  const nextToken = newHistoryToken()
  if (pendingFrameReplace?.timer) clearTimeout(pendingFrameReplace.timer)
  // replace 命令一旦发出就不可撤销：慢导航时不能用超时将 token 退回旧文档，
  // 否则新 Document 落地后所有消息都会被当作伪造。子页只在 location.replace 同步抛错时回报 failed。
  pendingFrameReplace = { route, marked, phase: 'navigate', nextToken, accepted: false, timer: null }
  armFrameLandingWatchdog(pendingFrameReplace)
  try {
    frame!.contentWindow?.postMessage({
      type: 'bk-drawer-replace', token: previousToken, nextToken,
      url: marked, webFull: route.webFull,
    }, previousOrigin)
  } catch { recoverFrameReplace(route) }
}

function replaceFrameDocument(route: DrawerHistoryRoute, marked: string, fresh: boolean): void {
  cancelPendingFrameReplace()
  if (loadCover) loadCover.style.backgroundImage = route.cover ? `url("${route.cover}")` : ''
  setLoading(true)
  if (fresh) { finishFrameReplace(route, marked, true); return }

  // 先让旧文档确认已暂停，再整页 replace；无 ack 时宁可保留并恢复旧页，也不走会污染联合历史的 iframe.src。
  const timer = setTimeout(() => {
    if (pendingFrameReplace?.route !== route) return
    recoverFrameReplace(route)
  }, 350)
  pendingFrameReplace = { route, marked, phase: 'suspend', timer }
  postFrameCommand('bk-drawer-suspend')
}

function setLoading(on: boolean): void {
  panel?.classList.toggle('loading', on)
  if (loadTimer) { clearTimeout(loadTimer); loadTimer = null }
  if (on) loadTimer = setTimeout(() => setLoading(false), 6000) // 兜底：信号迟迟不来也撤遮罩
}

// 首次使用时造唯一 iframe；后续只导航/停放这个元素，绝不再创建第二个。
function createFrame(): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.className = `${NS}-dframe`
  f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write'
  f.allowFullscreen = true
  // sandbox：不含 allow-top-navigation → 禁止被嵌视频页把顶层窗口导航走（frame-busting）。须在设 src 前就位。
  f.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals allow-downloads')
  // 若用户在慢加载期间已经关闭，导航完成后再补一次暂停，避免新文档在隐藏抽屉里自动播放。
  f.addEventListener('load', () => { if (!drawerOpen && f === frame) postFrameCommand('bk-drawer-suspend') })
  return f
}

function ensureDom(): void {
  if (mask) return
  if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = CSS; (document.head || document.documentElement).appendChild(s) }
  mask = document.createElement('div')
  mask.className = `${NS}-dmask`
  panel = document.createElement('div')
  panel.className = `${NS}-drawer`
  // Core 在抽屉 iframe 内的两个揭幕信号：视频首帧就绪 / 网页全屏已铺满。（揭幕由此触发，setLoading 自带超时兜底）
  // 挂在 window 上、判 e.source===唯一 frameWin()；子文档换页再用 token 隔离新旧消息。
  window.addEventListener('message', (e) => {
    if (e.source !== frameWin()) return
    const route = activeRoute
    if (!route || !e.data || typeof e.data !== 'object') return
    const pendingAtArrival = pendingFrameReplace
    const fromCurrentDocument = e.data.token === frameToken
    const fromPendingDocument = pendingAtArrival?.phase === 'navigate'
      && e.data.token === pendingAtArrival.nextToken
    if (!fromCurrentDocument && !fromPendingDocument) return
    // source 防旁框架伪造，origin 防外站冒充；每个 Document 的独立 nonce 拒绝同一 WindowProxy 上旧文档的迟到消息。
    let expectedOrigin: string
    try {
      expectedOrigin = new URL(fromPendingDocument ? pendingAtArrival.route.url : framePublicUrl, location.href).origin
    } catch { return }
    if (e.origin !== expectedOrigin) return
    // 新 nonce 的首条消息才证明 Document 已落地。此前即使旧页已确认 replace，
    // 也保留 navigate pending，使 A→B→C 在 B 导航窗口中仍能只排队最后的 C。
    if (fromPendingDocument && pendingAtArrival?.nextToken) {
      acceptFrameReplace(pendingAtArrival)
      cancelPendingFrameReplace()
      const queued = queuedFrameReplace
      queuedFrameReplace = null
      if (drawerOpen && queued) {
        replaceFrameDocument(queued.route, queued.marked, false)
        return
      }
    }
    if (e.data.type === 'bk-drawer-ready') {
      if (pendingFrameReplace) return
      frameReady = true
      gotReady = true
      if (!drawerOpen) postFrameCommand('bk-drawer-suspend')
      else if (tryReveal()) postFrameCommand('bk-drawer-resume')
    }
    else if (e.data.type === 'bk-drawer-suspended') {
      stopSuspendRetries()
      const pending = pendingFrameReplace
      if (pending?.phase === 'suspend' && drawerOpen) requestFrameReplace(pending.route, pending.marked)
    }
    else if (
      e.data.type === 'bk-drawer-replacing' && pendingFrameReplace?.phase === 'navigate'
      && e.data.nextToken === pendingFrameReplace.nextToken
    ) {
      const pending = pendingFrameReplace
      acceptFrameReplace(pending)
    }
    else if (
      e.data.type === 'bk-drawer-replace-failed' && pendingFrameReplace?.phase === 'navigate'
      && e.data.nextToken === pendingFrameReplace.nextToken
    ) {
      recoverFrameReplace(pendingFrameReplace.route)
    }
    else if (
      e.data.type === 'bk-drawer-navigating' && typeof e.data.url === 'string'
      && typeof e.data.nextToken === 'string' && /^[0-9a-z-]{8,}$/i.test(e.data.nextToken)
    ) {
      const expectedOrigin = new URL(framePublicUrl, location.href).origin
      const publicUrl = safeDrawerVideoUrl(e.data.url, expectedOrigin)
      if (!publicUrl) return
      const superseded = pendingFrameReplace
      const latestParentTarget = drawerOpen
        ? (queuedFrameReplace || (superseded ? { route: superseded.route, marked: superseded.marked } : null))
        : null
      cancelPendingFrameReplace()
      const internalRoute = {
        ...route,
        token: frameRouteToken || route.token,
        url: publicUrl,
        webFull: frameWebFull,
      }
      const internalMarked = publicUrl.split('#')[0] + (internalRoute.webFull ? MARK_WEB : MARK)
      // 子页在发 navigating 前已决定 location.replace，这个导航不可撤销。
      // 即使父页同时要去 B，也要先接管实际在途的 D nonce，再把最新父页目标排在 D 落地之后。
      pendingFrameReplace = {
        route: internalRoute,
        marked: internalMarked,
        phase: 'navigate',
        nextToken: e.data.nextToken,
        accepted: false,
        timer: null,
      }
      armFrameLandingWatchdog(pendingFrameReplace)
      acceptFrameReplace(pendingFrameReplace)
      const sameAsParent = latestParentTarget?.route.url === publicUrl
        && latestParentTarget.route.webFull === internalRoute.webFull
      queuedFrameReplace = sameAsParent ? null : latestParentTarget
      if (!queuedFrameReplace) {
        curUrl = publicUrl
        activeRoute = internalRoute
        if (drawerOpen && historyActive && !historyClosing) replaceDrawerHistory(internalRoute)
      }
      if (drawerOpen) setLoading(true)
    }
    else if (e.data.type === 'bk-drawer-webfull') {
      if (pendingFrameReplace) return
      gotWebfull = true
      if (tryReveal()) postFrameCommand('bk-drawer-resume')
    }
    else if (e.data.type === 'bk-drawer-reveal-timeout') {
      if (pendingFrameReplace) return
      // selector/网页全屏按钮变更时降级为普通揭幕；不能只撤遮罩却让初始媒体闸门永久保持暂停。
      gotWebfull = true
      if (drawerOpen && gotReady && tryReveal()) postFrameCommand('bk-drawer-resume')
    }
    else if (e.data.type === 'bk-drawer-close') closeDrawer() // iframe 内获得焦点时，Esc 由子页桥接回来
    else if (e.data.type === 'bk-drawer-location' && typeof e.data.url === 'string') {
      if (!pendingFrameReplace) syncDrawerHistory(e.data.url)
    }
  })
  window.addEventListener('popstate', (e) => {
    const stateRoute = readDrawerRoute(e.state)
    const token = activeRoute?.token || ''
    const route = stateRoute?.token === token ? stateRoute : null
    const atOrigin = !!token && (readDrawerOrigin(e.state) === token || (!route && location.href === historyOriginUrl))

    if (historyClosing) {
      e.stopImmediatePropagation()
      if (atOrigin) { finishHistoryClose(); return }
      // 抽屉期间若站点意外 push 了额外 entry，继续退到我们标记过的 origin，不能 replace 错层。
      try { history.back() } catch { finishHistoryClose() }
      return
    }

    if (route) {
      e.stopImmediatePropagation()
      historyActive = true
      historyOwned = true
      activeRoute = route
      showDrawer(route)
      return
    }

    // state marker 被站点覆盖时，同源页仍可用已缓存的公开视频 URL 识别 Forward 并补回 marker。
    if (!historyActive && historyOwned && activeRoute) {
      const display = drawerDisplayUrl(activeRoute.url, historyOriginUrl)
      if (display === location.href) {
        e.stopImmediatePropagation()
        replaceDrawerHistory(activeRoute)
        showDrawer(activeRoute)
        return
      }
    }

    if (historyActive && historyOwned) {
      e.stopImmediatePropagation()
      historyActive = false
      try { nativeReplaceState.call(history, historyOriginState, '', historyOriginUrl) } catch { /* ignore */ }
      hideDrawer()
      return
    }

    // push 失败时绝不拦截真实 Back；仅在站点处理完后收起仍显示的降级抽屉。
    if (panel?.classList.contains('on')) {
      queueMicrotask(() => { activeRoute = null; hideDrawer() })
    }
  }, true)
  // B 站偶尔会 replaceState 覆盖自定义字段。低频只读检查，缺失时才用捕获的原生方法补回；
  // 因而正常播放零写入，也不依赖站点后来是否重包 history 方法。
  setInterval(() => {
    if (!drawerOpen || !historyActive || historyClosing || !activeRoute) return
    if (readDrawerRoute(history.state)?.token === activeRoute.token) return
    replaceDrawerHistory(activeRoute)
  }, 500)
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

function showDrawer(route: DrawerHistoryRoute): void {
  ensureDom()
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  drawerOpen = true
  panel!.classList.remove('parked')
  curUrl = route.url
  curWebFull = route.webFull
  curImmersive = route.immersive
  const marked = route.url.split('#')[0] + (route.webFull ? MARK_WEB : MARK) // 去掉原 URL 的 hash，换上抽屉标记（否则 Core 认不到、不隐顶栏/不发揭幕信号）
  const fresh = !frame
  if (!frame) frame = createFrame()
  const irreversibleReplace = pendingFrameReplace?.phase === 'navigate' ? pendingFrameReplace : null
  if (irreversibleReplace) {
    // 旧页已执行 location.replace，无法再取消。先等它落地，然后只执行最后一个点选目标。
    const sameTarget = irreversibleReplace.route.url === route.url
      && irreversibleReplace.route.webFull === route.webFull
    queuedFrameReplace = sameTarget ? null : { route, marked }
    if (!irreversibleReplace.timer) armFrameLandingWatchdog(irreversibleReplace)
    setLoading(true)
  } else {
    // 暂停阶段仍可撤销；迟到 ack 不得提交旧目标。
    cancelPendingFrameReplace()
    const reuseLoadedDocument = frameReady && canReuseDrawerDocument(
      { token: frameRouteToken, url: framePublicUrl, webFull: frameWebFull },
      route,
    )
    const alreadyNavigating = !frameReady && frameRouteToken === route.token
      && framePublicUrl === route.url && frameWebFull === route.webFull
    if (alreadyNavigating) {
      setLoading(true)
    } else if (!reuseLoadedDocument) {
      replaceFrameDocument(route, marked, fresh)
    } else {
      // 浏览器 Forward / 快速复开同一会话：文档仍在，直接恢复播放与焦点，不再重载。
      if (tryReveal()) postFrameCommand('bk-drawer-resume')
    }
  }
  // 首次 src/name 在插入前设好，使初始 about:blank→视频成为初始导航；后续由上面的 location.replace 换页。
  if (fresh) panel!.insertBefore(frame, panel!.firstChild)
  document.documentElement.style.overflow = 'hidden' // 锁底层滚动
  requestAnimationFrame(() => { mask!.classList.add('on'); panel!.classList.add('on'); ctrls!.classList.add('on') })
}

export function openDrawer(url: string, cover = '', webFull = false, immersive = false): void {
  // history.back() 已发出后不能可靠取消；把极短窗口内的新点击排到 origin 落地后再开，避免新抽屉被旧 popstate 关错。
  if (historyClosing) { pendingOpen = { url, cover, webFull, immersive }; return }
  const existing = historyActive ? activeRoute : null
  const route: DrawerHistoryRoute = {
    // history 会话 token 跨 Document 沿用；window.name 里的 Document nonce 每次换页更新。
    token: existing?.token || frameRouteToken || newHistoryToken(),
    url,
    cover,
    webFull,
    immersive,
  }
  if (existing) {
    replaceDrawerHistory(route)
  } else {
    activeRoute = route
    pushDrawerHistory(route)
  }
  showDrawer(route)
}

function hideDrawer(): void {
  if (!panel || !mask || !ctrls) return
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  drawerOpen = false
  queuedFrameReplace = null
  // suspend 尚未换页，可安全撤销；navigate 已不可逆，必须保留 nextToken 以接管新文档。
  if (pendingFrameReplace?.phase === 'suspend') cancelPendingFrameReplace()
  // 关闭即停声/停解码推进，但不清 src、不拆 MSE、不移除 iframe；完整页面常驻在唯一 browsing context 中。
  suspendFrameWithRetry()
  // iframe 不再被移除，必须主动把键盘焦点还给顶层；否则空格等快捷键可能继续落进隐藏播放器。
  try { frame?.blur() } catch { /* ignore */ }
  try { window.focus() } catch { /* ignore */ }
  mask.classList.remove('on')
  panel.classList.remove('on')
  ctrls.classList.remove('on')
  setLoading(false)
  document.documentElement.style.overflow = ''
  // 过渡结束仅把面板设为不可见；iframe 元素及 browsing context 常驻，保证整个顶层页始终至多一个。
  // 不设 display:none，避免播放器在恢复尺寸时重建；visibility:hidden 足以停止合成展示，媒体由上面的 suspend 暂停。
  closeTimer = setTimeout(() => {
    if (drawerOpen) return
    panel?.classList.add('parked')
  }, 340)
}

export function closeDrawer(): void {
  hideDrawer()
  if (historyOwned && historyActive) consumeDrawerHistory()
  // push 失败时也保留最后 route 作为隐藏 iframe 的消息鉴权上下文；下次 open 仍会创建新的 history 会话。
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
