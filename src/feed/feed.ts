import { fetchAppFeed, gmRequest, type FeedCard } from './app-api'

/**
 * App 推荐 feed 就地接管首页：
 *  - 找到 B 站原生推荐流容器 → 隐藏 → 在原位挂我们自己的网格；
 *  - 纯 DOM 卡 + content-visibility:auto（屏外自动跳过布局/绘制，Safari 友好、不闪屏）；
 *  - 封面 IntersectionObserver 懒加载 + 屏外卸载（砍解码位图内存）；
 *  - 触底加载下一页；本会话 bvid 去重（跨刷新持久去重留待后续）。
 * 运行在隔离世界（@grant GM.xmlHttpRequest）——全程只操作 DOM，不读页面 JS。
 */
const NS = 'bk-feed'
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

const seen = new Set<string>() // 已展示 bvid，去重
let grid: HTMLElement | null = null
let sentinel: HTMLElement | null = null
let loading = false
let exhausted = false // 匿名固定池刷完（连续多页无新内容）→ 停止并提示
let cardIo: IntersectionObserver | null = null
let sentinelIo: IntersectionObserver | null = null
let feedGen = 0 // 代际令牌：每次重新接管/刷新自增；在途 loadMore 察觉代际变化即作废，避免竞态写入新 grid

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[ch])
const coverUrl = (u: string) => (u ? u.replace(/^http:/, 'https:') : BLANK)

// 封面遮罩的播放/弹幕图标（跟随 currentColor=白）
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const DM_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 16H9l-5 4V5.5A1.5 1.5 0 0 1 5.5 4z"/></svg>'
const stripUnit = (s: string) => s.replace(/观看|播放|弹幕|次/g, '').trim() // 遮罩上有图标，去掉文字单位

function getAccessKey(): string {
  try {
    return (JSON.parse(localStorage.getItem('bilikit:settings') || '{}') as any)['feed.accessKey'] || ''
  } catch {
    return ''
  }
}

function injectStyle(): void {
  if (document.getElementById('bk-feed-style')) return
  const s = document.createElement('style')
  s.id = 'bk-feed-style'
  s.textContent = `
    .${NS}{ display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:22px 16px; padding:16px 0; }
    .${NS}-card{ cursor:pointer; content-visibility:auto; contain-intrinsic-size:auto 330px; transition:transform .18s ease; }
    .${NS}-card:hover{ transform:translateY(-4px); } /* 悬浮浮起（transform → 合成层，不触发重排） */
    .${NS}-cover{ position:relative; aspect-ratio:16/9; border-radius:8px; overflow:hidden; background:var(--bg2,#e3e5e7); transition:box-shadow .18s ease; }
    .${NS}-card:hover .${NS}-cover{ box-shadow:0 6px 20px rgba(0,0,0,.22); }
    .${NS}-cover img{ width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .35s ease; }
    .${NS}-cover.loaded img{ opacity:1; }
    /* hover 雪碧图预览：盖在封面上，鼠标横向刮帧；在遮罩(z-index:2)之下、图片之上 */
    .${NS}-preview{ position:absolute; inset:0; z-index:1; background-repeat:no-repeat; opacity:0; transition:opacity .15s ease; pointer-events:none; }
    .${NS}-preview.on{ opacity:1; }
    /* 预览进度条：底部细条，随播放推进（scaleX → 合成层）。z-index:3 压在遮罩之上，短视频也看得清进度 */
    .${NS}-pbar{ position:absolute; left:0; right:0; bottom:0; z-index:3; height:3px; background:rgba(0,0,0,.28); opacity:0; transition:opacity .15s ease; pointer-events:none; }
    .${NS}-pbar.on{ opacity:1; }
    .${NS}-pbar i{ display:block; width:100%; height:100%; background:var(--brand_blue,#00aeec); transform:scaleX(0); transform-origin:left; }
    /* 骨架微光：统一走「合成层友好的 transform 位移伪元素」——封面(未加载)、骨架条、头像同一套，
       只动 transform（GPU 合成，不逐帧重绘），滚动/加载期都不掉帧。封面 .loaded/.failed 后伪元素消失。 */
    .${NS}-shimmer{ position:relative; overflow:hidden; background-color:var(--bg2,#e3e5e7); }
    .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}-shimmer::after{
      content:''; position:absolute; inset:0;
      background:linear-gradient(90deg, transparent 25%, rgba(255,255,255,.28) 50%, transparent 75%);
      transform:translateX(-100%); animation:bk-shimmer 1.6s linear infinite;
    }
    /* 深色模式下白色高光过刺眼，压到很淡 */
    @media (prefers-color-scheme: dark){
      .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}-shimmer::after{ background:linear-gradient(90deg, transparent 25%, rgba(255,255,255,.09) 50%, transparent 75%); }
    }
    @keyframes bk-shimmer{ to{ transform:translateX(100%); } }
    /* 封面底部遮罩：左「播放·弹幕」右「时长」 */
    /* z-index:1 必需：封面 img 有 opacity 过渡，Safari 会把它提升为合成层、盖住本遮罩；
       给遮罩显式 z-index 才能压在图片层之上（否则 z-index:auto 不进合成层，被图片遮住）。 */
    .${NS}-mask{ position:absolute; left:0; right:0; bottom:0; z-index:2; display:flex; align-items:flex-end; justify-content:space-between; padding:8px 8px 7px; color:#fff; font-size:12px; line-height:1; background:linear-gradient(transparent, rgba(0,0,0,.85)); pointer-events:none; }
    .${NS}-mstat{ display:flex; align-items:center; gap:9px; }
    .${NS}-mstat span{ display:inline-flex; align-items:center; gap:3px; }
    .${NS}-mstat svg{ width:15px; height:15px; }
    /* 下方：头像独占左栏，右栏上标题、下「UP名 · 日期」 */
    .${NS}-bottom{ display:flex; gap:10px; margin-top:9px; align-items:flex-start; }
    .${NS}-face{ width:34px; height:34px; flex:0 0 34px; border-radius:50%; object-fit:cover; background:var(--bg2,#e3e5e7); }
    .${NS}-right{ flex:1; min-width:0; }
    .${NS}-title{ margin:0 0 6px; font-size:15px; font-weight:500; line-height:1.4; color:var(--text1,#18191c); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .${NS}-sub{ display:flex; align-items:center; font-size:13px; color:var(--text3,#9499a0); }
    .${NS}-who{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .${NS}-sub i{ margin:0 5px; font-style:normal; }
    /* 推荐理由行内 pill（学 Gate）：只描边+文字色、不填充；实际配色由 B 站 reason style 内联覆盖 */
    .${NS}-badge{ flex:none; margin-right:6px; padding:0 6px; border:1px solid var(--brand_blue,#00aeec); border-radius:6px; color:var(--brand_blue,#00aeec); background:transparent; font-size:11px; line-height:16px; }
    /* 骨架占位（数据未到时） */
    .${NS}-skline{ height:13px; border-radius:4px; margin-bottom:8px; }
    .${NS}-sentinel{ grid-column:1/-1; height:1px; }
    .${NS}-tip{ grid-column:1/-1; text-align:center; color:var(--text3,#9499a0); font-size:13px; padding:20px; }
    .${NS}-fab{ position:fixed; right:24px; bottom:32px; z-index:1000; display:flex; flex-direction:column; gap:10px; }
    .${NS}-fab button{ width:44px; height:44px; border-radius:50%; border:1px solid var(--line_regular,#e3e5e7); background:var(--bg1,#fff); color:var(--text2,#61666d); cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.14); display:flex; align-items:center; justify-content:center; padding:0; transition:opacity .18s, transform .18s, color .18s; }
    .${NS}-fab button:hover{ color:var(--brand_blue,#00aeec); transform:translateY(-2px); }
    .${NS}-fab button:active{ transform:translateY(0); }
    .${NS}-fab .bk-top{ opacity:0; pointer-events:none; transform:scale(.85); }      /* 默认藏，滚动后现 */
    .${NS}-fab.scrolled .bk-top{ opacity:1; pointer-events:auto; transform:none; }
    .${NS}-fab button.busy{ pointer-events:none; }
    .${NS}-fab button.busy svg{ animation:bk-spin .8s linear infinite; }
    @keyframes bk-spin{ to{ transform:rotate(360deg); } }
  `
  ;(document.head || document.documentElement).appendChild(s)
}

// 清理首页原生 chrome（接管 feed 后残留的干扰件）。只注入一次。
function hideNativeChrome(): void {
  if (document.getElementById('bk-feed-chrome')) return
  const s = document.createElement('style')
  s.id = 'bk-feed-chrome'
  s.textContent = `
    .feed-roll-btn { display: none !important; }        /* 右侧「换一换」 */
    .palette-button-wrap { display: none !important; }   /* 右下角 刷新内容/更多/返回顶部 */
    /* 分区栏「不钉顶」：.header-channel 是 B 站在滚动后注入的钉顶副本（首屏时 h=0、空），
       真正可见的分区在 .bili-header 内、会随页滚走。隐掉这个副本即可：分区仍在（顶部那份），
       只是不再钉顶，也避开了它注入高度时引发的画面抽搐。 */
    .header-channel { display: none !important; }
  `
  ;(document.head || document.documentElement).appendChild(s)
}

// ---- hover 预览：拉 videoshot 雪碧图，鼠标横向刮帧 ----
interface Shot { images: string[]; index: number[]; xlen: number; ylen: number }
const shotCache = new Map<string, Shot | null>() // 按 bvid 缓存（含「无预览」的 null），避免重复请求

// 预加载雪碧图并解码，避免「塞进 background-image 后要等下载才出画」的空白等待
const imgLoaded = new Set<string>()
function preloadImg(src: string): Promise<void> {
  if (!src || imgLoaded.has(src)) return Promise.resolve()
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = im.onerror = () => { imgLoaded.add(src); resolve() }
    im.src = src
  })
}

async function fetchVideoshot(bvid: string): Promise<Shot | null> {
  if (shotCache.has(bvid)) return shotCache.get(bvid) as Shot | null
  let shot: Shot | null = null
  try {
    const text = await gmRequest({ method: 'GET', url: `https://api.bilibili.com/x/player/videoshot?bvid=${bvid}&index=1` })
    const d = JSON.parse(text)?.data
    if (d && Array.isArray(d.image) && d.image.length && Array.isArray(d.index) && d.index.length) {
      shot = { images: d.image.map((u: string) => coverUrl(u)), index: d.index, xlen: d.img_x_len || 10, ylen: d.img_y_len || 10 }
    }
  } catch { /* 无预览/网络失败 → 记为 null，不再重试 */ }
  shotCache.set(bvid, shot)
  return shot
}

// 给封面挂 hover 预览：停留 ~150ms 才拉数据（避免划过就请求），拿到并预载首图后自动轮播。
// 用 rAF + 固定总时长(RUN)驱动：无论帧多帧少都摊到同样时长，短视频不再一闪而过；底部进度条随播放推进。
function setupHoverPreview(cover: HTMLElement, bvid: string): void {
  const RUN = 8000 // 全片轮播总时长（ms）——学 Gate，短视频也放满 8s，看得清
  const FRAME_MS = 250 // 换图最短间隔：抽稀成「幻灯片」，避免帧太密闪烁（进度条仍每帧平滑）
  let hovering = false
  let enterTimer: ReturnType<typeof setTimeout> | null = null
  let rafId = 0
  let startT = 0
  let lastFrameAt = 0
  let lastIdx = -1
  let preview: HTMLElement | null = null
  let pbar: HTMLElement | null = null
  let bar: HTMLElement | null = null
  let shot: Shot | null = null

  const showFrame = (idx: number) => {
    if (!preview || !shot) return
    const per = shot.xlen * shot.ylen
    const sheet = Math.min(Math.floor(idx / per), shot.images.length - 1)
    const local = idx % per
    const col = local % shot.xlen
    const row = Math.floor(local / shot.xlen)
    preview.style.backgroundImage = `url("${shot.images[sheet]}")`
    preview.style.backgroundSize = `${shot.xlen * 100}% ${shot.ylen * 100}%`
    preview.style.backgroundPosition =
      `${shot.xlen > 1 ? (col / (shot.xlen - 1)) * 100 : 0}% ${shot.ylen > 1 ? (row / (shot.ylen - 1)) * 100 : 0}%`
  }

  const tick = (now: number) => {
    if (!hovering || !shot) { rafId = 0; return }
    const p = ((now - startT) % RUN) / RUN // 0..1，循环
    if (bar) bar.style.transform = `scaleX(${p})` // 进度条每帧平滑
    if (now - lastFrameAt >= FRAME_MS) { // 换图节流：最多每 FRAME_MS 换一帧 → 抽稀不闪
      lastFrameAt = now
      const idx = Math.min(Math.floor(p * shot.index.length), shot.index.length - 1)
      if (idx !== lastIdx) { lastIdx = idx; showFrame(idx) }
    }
    rafId = requestAnimationFrame(tick)
  }

  const stop = () => {
    hovering = false
    if (enterTimer) { clearTimeout(enterTimer); enterTimer = null }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
    preview?.classList.remove('on')
    pbar?.classList.remove('on')
  }

  cover.addEventListener('mouseenter', () => {
    if (hovering) return
    hovering = true
    enterTimer = setTimeout(async () => {
      enterTimer = null
      const s = await fetchVideoshot(bvid)
      if (!s || !hovering) return
      await preloadImg(s.images[0]) // 首图先解码好，出画即完整
      if (!hovering) return
      shot = s
      if (!preview) {
        preview = document.createElement('div'); preview.className = `${NS}-preview`; cover.appendChild(preview)
        pbar = document.createElement('div'); pbar.className = `${NS}-pbar`
        bar = document.createElement('i'); pbar.appendChild(bar); cover.appendChild(pbar)
      }
      lastIdx = -1
      lastFrameAt = 0
      startT = performance.now()
      showFrame(0)
      preview.classList.add('on'); pbar!.classList.add('on')
      rafId = requestAnimationFrame(tick)
      for (const src of s.images.slice(1)) void preloadImg(src) // 其余雪碧图后台预载
    }, 150)
  })
  cover.addEventListener('mouseleave', stop)
}

function makeCard(c: FeedCard): HTMLElement {
  const el = document.createElement('div')
  el.className = `${NS}-card`
  // 封面遮罩左侧：播放 + 弹幕（带图标；缺项省略）
  const mstat =
    (c.play ? `<span>${PLAY_SVG}${esc(stripUnit(c.play))}</span>` : '') +
    (c.danmaku ? `<span>${DM_SVG}${esc(stripUnit(c.danmaku))}</span>` : '')
  // 推荐理由小徽章（如「已关注」）放在 UP 名之前，学 Gate 的行内 pill，统一用品牌色描边；
  // 名字+日期单独一段以便省略号；整行 flex 居中对齐徽章与文字。
  const badge = c.reason ? `<span class="${NS}-badge">${esc(c.reason)}</span>` : ''
  const who = esc(c.up) + (c.date ? `<i>·</i>${esc(c.date)}` : '')
  const sub = badge + `<span class="${NS}-who">${who}</span>`
  el.innerHTML =
    `<div class="${NS}-cover"><img alt="" data-src="${esc(coverUrl(c.cover))}">` +
    `<div class="${NS}-mask"><div class="${NS}-mstat">${mstat}</div>` +
    (c.duration ? `<span>${esc(c.duration)}</span>` : '<span></span>') +
    `</div></div>` +
    `<div class="${NS}-bottom">` +
    (c.face ? `<img class="${NS}-face" src="${esc(coverUrl(c.face))}" alt="" loading="lazy">` : `<div class="${NS}-face"></div>`) +
    `<div class="${NS}-right">` +
    `<div class="${NS}-title">${esc(c.title)}</div>` +
    `<div class="${NS}-sub">${sub}</div>` +
    `</div></div>`
  // 封面完全加载后才淡入（撤骨架微光）；卸载成 BLANK 时移除 .loaded → 微光回来
  const coverEl = el.querySelector(`.${NS}-cover`) as HTMLElement
  const imgEl = el.querySelector('img') as HTMLImageElement
  imgEl.addEventListener('load', () => {
    coverEl.classList.toggle('loaded', !imgEl.src.startsWith('data:'))
  })
  // 封面 404/解码失败：标 .failed 停微光、露灰底，避免那张卡无限转骨架
  imgEl.addEventListener('error', () => { if (!imgEl.src.startsWith('data:')) coverEl.classList.add('failed') })
  if (c.bvid) setupHoverPreview(coverEl, c.bvid) // hover 雪碧图预览
  el.addEventListener('click', () => {
    const url = c.bvid ? `https://www.bilibili.com/video/${c.bvid}` : c.uri
    if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener') // 只开 http(s)，防 javascript:/开放重定向
  })
  return el // 注意：observe 要等插入 DOM 后再做（Safari 下观察未连接元素不可靠）
}

// 骨架占位卡：数据未到时先铺满首屏，避免空白。纯 shimmer，无图片、不被 IO 观察。
function makeSkeleton(): HTMLElement {
  const el = document.createElement('div')
  el.className = `${NS}-card ${NS}-skcard`
  el.innerHTML =
    `<div class="${NS}-cover"></div>` +
    `<div class="${NS}-bottom">` +
    `<div class="${NS}-face ${NS}-shimmer"></div>` +
    `<div class="${NS}-right">` +
    `<div class="${NS}-shimmer ${NS}-skline"></div>` +
    `<div class="${NS}-shimmer ${NS}-skline" style="width:70%"></div>` +
    `<div class="${NS}-shimmer ${NS}-skline" style="width:45%;margin-top:6px"></div>` +
    `</div></div>`
  return el
}

function renderSkeletons(n: number): void {
  if (!grid || !sentinel) return
  const frag = document.createDocumentFragment()
  for (let i = 0; i < n; i++) frag.appendChild(makeSkeleton())
  grid.insertBefore(frag, sentinel)
}

function clearSkeletons(): void {
  if (grid) grid.querySelectorAll(`.${NS}-skcard`).forEach((n) => n.remove())
}

// 哨兵是否还在「加载区」内（距视口底 <1000px）——用它驱动循环，不依赖 IO 的相交变化重触发
function sentinelInView(): boolean {
  if (!sentinel) return false
  // 填充目标按屏高成比例：让已加载内容延伸到「约两屏」高度（API 每页约 16 条，循环多拉直到填满）。
  // 大屏自动多拉几页、不再显得稀疏；小屏也按比例不过量。
  return sentinel.getBoundingClientRect().top < window.innerHeight * 2
}

function showTip(text: string): void {
  if (!grid) return
  let tip = grid.querySelector(`.${NS}-tip`) as HTMLElement | null
  if (!tip) { tip = document.createElement('div'); tip.className = `${NS}-tip`; grid.appendChild(tip) }
  tip.textContent = text
}

function removeTip(): void {
  grid?.querySelector(`.${NS}-tip`)?.remove()
}

// 是否已有真实卡片（骨架 .skcard 不算）——用于判定「首屏就失败」
function hasRealCard(): boolean {
  return !!grid && !!grid.querySelector(`.${NS}-card:not(.${NS}-skcard)`)
}

async function loadMore(): Promise<void> {
  if (loading || exhausted || !grid || !sentinel) return
  loading = true
  const gen = feedGen // 记录本次代际；重新接管/刷新会改变它 → 本次作废
  let failed = false
  try {
    let emptyStreak = 0
    // 至少强制拉一页（first）：骨架占位会撑高哨兵，若只看 sentinelInView 窄视口下可能一页都不拉。
    // 之后再按「哨兵是否仍在加载区」决定是否继续，直到填满或连续 3 页无新内容（匿名池耗尽）。
    let first = true
    while ((first || sentinelInView()) && emptyStreak < 3) {
      first = false
      const { code, message, cards } = await fetchAppFeed(getAccessKey())
      if (gen !== feedGen) return // 期间发生了重新接管/刷新，本次已过期，交给新一轮（finally 不清新代的状态）
      if (code !== 0) { console.warn(`[BiliKit Feed] 加载失败 code=${code} ${message}`); failed = true; break }
      clearSkeletons() // 拿到数据后立刻撤骨架：否则骨架占位高度会撑出哨兵，导致填充循环提前退出
      removeTip() // 有新数据 → 撤掉上一次的「失败/刷完」提示
      // 批量插入：先攒进 DocumentFragment，再一次 insertBefore，减少逐张插入的重排
      const frag = document.createDocumentFragment()
      const fresh: HTMLElement[] = []
      for (const c of cards) {
        if (!c.bvid || seen.has(c.bvid)) continue
        seen.add(c.bvid)
        const el = makeCard(c)
        fresh.push(el)
        frag.appendChild(el)
      }
      if (fresh.length) {
        grid.insertBefore(frag, sentinel)
        if (cardIo) for (const el of fresh) cardIo.observe(el) // 连接进 DOM 后再观察
      }
      emptyStreak = fresh.length === 0 ? emptyStreak + 1 : 0
    }
    if (emptyStreak >= 3) {
      exhausted = true
      showTip('匿名推荐已刷完（B 站给匿名请求的是固定内容池）。配置 access_key 可看个性化、不重复的推荐。')
    }
  } catch (e) {
    console.error('[BiliKit Feed] 加载出错：', e)
    failed = true
  } finally {
    if (gen === feedGen) { clearSkeletons(); loading = false } // 仅当仍是本代才清理，别踩到新一轮的状态
  }
  // 首屏就失败（一张真实卡都没有）时给出可见提示，而不是空白/永久骨架
  if (gen === feedGen && failed && !hasRealCard()) showTip('加载失败，请稍后重试；若持续失败可在设置里配置 access_key 或检查网络。')
}

// 刷新内容：清空当前卡片（保留哨兵）+ 重置去重/耗尽 → 回顶 → 重新拉。
function refreshFeed(btn?: HTMLElement): void {
  if (!grid || !sentinel) return
  feedGen++ // 作废在途的 loadMore，使刷新即便在加载中也能立即生效（不再静默失效）
  loading = false
  if (cardIo) cardIo.disconnect() // 先解除对旧卡的观察，避免 observer 持有已删除节点（泄漏）
  for (const el of [...grid.children]) if (el !== sentinel) grid.removeChild(el)
  seen.clear()
  exhausted = false
  renderSkeletons(12) // 刷新时也先铺骨架
  if (btn) {
    btn.classList.add('busy')
    // loadMore 是异步循环，拉完首屏后解除转圈
    void loadMore().finally(() => btn.classList.remove('busy'))
  } else {
    void loadMore()
  }
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// 右下角悬浮按钮：刷新内容 + 返回顶部。只挂一次。
// 返回顶部的显隐用 IntersectionObserver 盯一个顶部标记（零 scroll 监听成本）。
let controls: HTMLElement | null = null
let markerEl: HTMLElement | null = null
let markerIo: IntersectionObserver | null = null
function mountControls(): void {
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
  refreshBtn.addEventListener('click', () => refreshFeed(refreshBtn))
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

function findNativeFeed(): HTMLElement | null {
  const card = document.querySelector('.feed-card, .bili-video-card')
  const byCard = card && (card.closest('.container') as HTMLElement | null)
  if (byCard) return byCard
  return (
    ([...document.querySelectorAll('.container')].find((c) => c.querySelector('.feed-card, .bili-video-card')) as HTMLElement) ||
    null
  )
}

/** 接管：隐藏原生流，在原位挂我们的网格。已挂或找不到则跳过。返回是否已就绪。 */
function takeover(): boolean {
  if (grid && grid.isConnected) return true
  const native = findNativeFeed()
  if (!native || !native.parentElement) return false

  // 重新接管前清理上一次的残留（SPA 重入首页）
  if (cardIo) cardIo.disconnect()
  if (sentinelIo) sentinelIo.disconnect()
  document.querySelectorAll(`.${NS}`).forEach((g) => g.remove()) // 移除旧/孤儿 grid，防止重复网格
  feedGen++ // 作废在途的 loadMore（SPA 重入撞上在途加载时的竞态）
  loading = false
  seen.clear()
  exhausted = false

  injectStyle()
  native.style.setProperty('display', 'none', 'important')

  // 给 content-visibility 人为加「提前量」：卡片进视口前 1000px 就切 visible（提前渲染+解码封面），
  // 远离再回到 auto（屏外跳过布局/绘制 + 卸封面位图）。兼顾消除 pop-in 与限制同时强渲染的工作集。
  cardIo = new IntersectionObserver(
    (ents) => {
      for (const e of ents) {
        const card = e.target as HTMLElement
        const img = card.querySelector('img') as HTMLImageElement | null
        if (e.isIntersecting) {
          card.style.contentVisibility = 'visible'
          if (img && (!img.getAttribute('src') || img.src.startsWith('data:')) && img.dataset.src) {
            img.parentElement?.classList.remove('failed') // 重新加载 → 清掉上次的失败态，给一次重试
            img.src = img.dataset.src
          }
        } else {
          card.style.contentVisibility = '' // 回退到样式表里的 auto：屏外跳过
          if (img && img.src && !img.src.startsWith('data:')) img.src = BLANK
        }
      }
    },
    { rootMargin: '1000px 0px' },
  )

  grid = document.createElement('div')
  grid.className = NS
  sentinel = document.createElement('div')
  sentinel.className = `${NS}-sentinel`
  grid.appendChild(sentinel)
  native.parentElement.insertBefore(grid, native)

  sentinelIo = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore() }, { rootMargin: '1000px 0px' })
  sentinelIo.observe(sentinel)

  mountControls() // 右下角：刷新内容 + 返回顶部
  renderSkeletons(12) // 数据到达前先铺骨架占位，避免空白
  loadMore() // 循环内会一直拉到填满首屏（哨兵离开加载区）
  return true
}

/** 只在首页顶层窗口生效；SPA 出入首页后原生流可能重建，轮询补挂。 */
export function mountFeed(): void {
  if (window.top !== window.self) return
  const onHome = () => location.pathname === '/' || location.pathname === '/index.html'
  const tick = () => { if (onHome()) { hideNativeChrome(); takeover() } }
  tick()
  let tries = 0
  const t = setInterval(() => {
    if (!onHome()) return
    hideNativeChrome()
    if (takeover()) { /* 挂上了；仍继续轮询以应对 SPA 重建 */ }
    if (++tries > 600) clearInterval(t) // ~10min 后停轮询兜底
  }, 1000)
}
