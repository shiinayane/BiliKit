import { fetchAppFeed, type FeedCard } from './app-api'

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
    .${NS}-card{ cursor:pointer; content-visibility:auto; contain-intrinsic-size:auto 290px; }
    .${NS}-cover{ position:relative; aspect-ratio:16/9; border-radius:8px; overflow:hidden; background:var(--bg2,#e3e5e7); }
    .${NS}-cover img{ width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .35s ease; }
    .${NS}-cover.loaded img{ opacity:1; }
    /* 骨架微光：铺在 var(--bg2) 底上的一条流动高光。用 background-position 匀速平移(linear)，
       不会像 transform+ease 那样在两端「停住」。封面 .loaded 后停掉。 */
    .${NS}-cover:not(.loaded), .${NS}-shimmer{
      background-color:var(--bg2,#e3e5e7);
      background-image:linear-gradient(90deg, rgba(255,255,255,0) 25%, rgba(255,255,255,.28) 50%, rgba(255,255,255,0) 75%);
      background-repeat:no-repeat; background-size:250% 100%;
      animation:bk-shimmer 1.6s linear infinite;
    }
    /* 深色模式下白色高光过刺眼，压到很淡 */
    @media (prefers-color-scheme: dark){
      .${NS}-cover:not(.loaded), .${NS}-shimmer{ background-image:linear-gradient(90deg, rgba(255,255,255,0) 25%, rgba(255,255,255,.09) 50%, rgba(255,255,255,0) 75%); }
    }
    @keyframes bk-shimmer{ 0%{ background-position:150% 0; } 100%{ background-position:-150% 0; } }
    /* 封面底部遮罩：左「播放·弹幕」右「时长」 */
    /* z-index:1 必需：封面 img 有 opacity 过渡，Safari 会把它提升为合成层、盖住本遮罩；
       给遮罩显式 z-index 才能压在图片层之上（否则 z-index:auto 不进合成层，被图片遮住）。 */
    .${NS}-mask{ position:absolute; left:0; right:0; bottom:0; z-index:1; display:flex; align-items:flex-end; justify-content:space-between; padding:8px 8px 7px; color:#fff; font-size:12px; line-height:1; background:linear-gradient(transparent, rgba(0,0,0,.85)); pointer-events:none; }
    .${NS}-mstat{ display:flex; align-items:center; gap:9px; }
    .${NS}-mstat span{ display:inline-flex; align-items:center; gap:3px; }
    .${NS}-mstat svg{ width:15px; height:15px; }
    /* 下方：头像独占左栏，右栏上标题、下「UP名 · 日期」 */
    .${NS}-bottom{ display:flex; gap:10px; margin-top:9px; align-items:flex-start; }
    .${NS}-face{ width:34px; height:34px; flex:0 0 34px; border-radius:50%; object-fit:cover; background:var(--bg2,#e3e5e7); }
    .${NS}-right{ flex:1; min-width:0; }
    .${NS}-title{ margin:0 0 6px; font-size:15px; font-weight:500; line-height:1.4; color:var(--text1,#18191c); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .${NS}-sub{ font-size:13px; color:var(--text3,#9499a0); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .${NS}-sub i{ margin:0 5px; font-style:normal; }
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

function makeCard(c: FeedCard): HTMLElement {
  const el = document.createElement('div')
  el.className = `${NS}-card`
  // 封面遮罩左侧：播放 + 弹幕（带图标；缺项省略）
  const mstat =
    (c.play ? `<span>${PLAY_SVG}${esc(stripUnit(c.play))}</span>` : '') +
    (c.danmaku ? `<span>${DM_SVG}${esc(stripUnit(c.danmaku))}</span>` : '')
  // 「UP名 · 日期」——中间圆点分割；无日期只显示名字
  const sub = esc(c.up) + (c.date ? `<i>·</i>${esc(c.date)}` : '')
  el.innerHTML =
    `<div class="${NS}-cover"><img alt="" data-src="${coverUrl(c.cover)}">` +
    `<div class="${NS}-mask"><div class="${NS}-mstat">${mstat}</div>` +
    (c.duration ? `<span>${esc(c.duration)}</span>` : '<span></span>') +
    `</div></div>` +
    `<div class="${NS}-bottom">` +
    (c.face ? `<img class="${NS}-face" src="${coverUrl(c.face)}" alt="" loading="lazy">` : `<div class="${NS}-face"></div>`) +
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
  el.addEventListener('click', () => {
    const url = c.bvid ? `https://www.bilibili.com/video/${c.bvid}` : c.uri
    if (url) window.open(url, '_blank')
  })
  if (cardIo) cardIo.observe(el) // 观察整卡：切 content-visibility + 封面加载/卸载
  return el
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
  return sentinel.getBoundingClientRect().top < window.innerHeight + 1000
}

function showTip(text: string): void {
  if (!grid) return
  let tip = grid.querySelector(`.${NS}-tip`) as HTMLElement | null
  if (!tip) { tip = document.createElement('div'); tip.className = `${NS}-tip`; grid.appendChild(tip) }
  tip.textContent = text
}

async function loadMore(): Promise<void> {
  if (loading || exhausted || !grid || !sentinel) return
  loading = true
  try {
    let emptyStreak = 0
    // 一直拉到「哨兵离开加载区」或「连续 3 页都无新内容」（匿名固定池耗尽）
    while (sentinelInView() && emptyStreak < 3) {
      const { code, message, cards } = await fetchAppFeed(getAccessKey())
      if (code !== 0) { console.warn(`[BiliKit Feed] 加载失败 code=${code} ${message}`); break }
      clearSkeletons() // 拿到真实数据，撤掉占位骨架
      let added = 0
      for (const c of cards) {
        if (!c.bvid || seen.has(c.bvid)) continue
        seen.add(c.bvid)
        grid.insertBefore(makeCard(c), sentinel)
        added++
      }
      emptyStreak = added === 0 ? emptyStreak + 1 : 0
    }
    if (emptyStreak >= 3) {
      exhausted = true
      showTip('匿名推荐已刷完（B 站给匿名请求的是固定内容池）。配置 access_key 可看个性化、不重复的推荐。')
    }
  } catch (e) {
    console.error('[BiliKit Feed] 加载出错：', e)
  } finally {
    loading = false
  }
}

// 刷新内容：清空当前卡片（保留哨兵）+ 重置去重/耗尽 → 回顶 → 重新拉。
function refreshFeed(btn?: HTMLElement): void {
  if (!grid || !sentinel || loading) return
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
function mountControls(): void {
  if (controls && controls.isConnected) return
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
  new IntersectionObserver((es) => fab.classList.toggle('scrolled', !es[0].isIntersecting)).observe(marker)
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
  seen.clear()
  exhausted = false

  injectStyle()
  native.style.setProperty('display', 'none', 'important')

  // 给 content-visibility 人为加「提前量」：卡片进视口前 1200px 就切 visible（提前渲染+解码封面），
  // 远离再回到 auto（屏外跳过布局/绘制 + 卸封面位图）。消除 pop-in 半拍，同时保内存。
  cardIo = new IntersectionObserver(
    (ents) => {
      for (const e of ents) {
        const card = e.target as HTMLElement
        const img = card.querySelector('img') as HTMLImageElement | null
        if (e.isIntersecting) {
          card.style.contentVisibility = 'visible'
          if (img && (!img.getAttribute('src') || img.src.startsWith('data:')) && img.dataset.src) img.src = img.dataset.src
        } else {
          card.style.contentVisibility = '' // 回退到样式表里的 auto：屏外跳过
          if (img && img.src && !img.src.startsWith('data:')) img.src = BLANK
        }
      }
    },
    { rootMargin: '1200px 0px' },
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
