import type { BiliKitModule, Cfg } from '../../core/module'
import { isPlayPage } from '../../core/pages'

/**
 * 回程：视频页左下角「回退栈」胶囊——记住站内连续跳视频的「来时路」，点一下跳回上一个并续播。
 * 迁自独立脚本 way-back.user.js，**只保留回退栈**（历史压扁那半随全站抽屉登场已无意义，去掉）。
 * 顶层窗口与 BiliKit 抽屉 iframe（#bk-drawer）都跑：抽屉里连续点相关视频也能就地回退。
 * 纯旁观记录：包一层 pushState 只记不改 + pagehide 兜底整页离开；栈存 sessionStorage（按标签页/frame 隔离）。
 * 胶囊深浅色跟随系统；「正在播放」行带动画声波条。
 */
const STACK_KEY = 'bilikit-wayback-stack'
const STACK_MAX = 20
const NS = 'bwb'

function init(cfg: Cfg): void {
  // 仅视频类页面跑（否则首页/搜索也会冒出胶囊、与设置齿轮撞位）。与 site-drawer 站下的边界同源。
  if (!isPlayPage()) return
  // 顶层窗口 或 我们的抽屉 iframe（其它嵌入 iframe 不跑）
  if (window.top !== window.self && !location.hash.includes('bk-drawer')) return
  if ((window as any).__BILIKIT_WAY_BACK__) return
  ;(window as any).__BILIKIT_WAY_BACK__ = true

  const resumeTime = cfg.get<boolean>('resumeTime') !== false
  // 抽屉标记：B 站 SPA 跳转会丢掉 URL 上的 #bk-drawer，跳回(整页 replace)时须补回，否则重载后
  // Core 不隐顶栏/去广告、回程也不跑。init 时（首个抽屉页 hash 还在）先记住它。
  const inDrawer = window.top !== window.self
  // 优先用当前 hash（含 -web 区分）；万一 hash 已被 SPA 抹掉但仍在抽屉内，兜底成 #bk-drawer——
  // 保证 drawerMark 与 inDrawer 同真同假，否则 jumpTo 不补标记也不设 JUMP_FLAG，重载后被 L18 挡掉且清栈。
  const drawerMark = (location.hash.match(/#bk-drawer(?:-web)?/) || [''])[0] || (inDrawer ? '#bk-drawer' : '')
  const JUMP_FLAG = 'bilikit-wb-jump'
  // 抽屉复用同一个 iframe，sessionStorage 跨导航不清 → 上一次会话的栈会漏进新会话。
  // 「全新打开一个视频」应清栈；但抽屉内「跳回」的整页 replace 不能清（jumpTo 会设 JUMP_FLAG 区分）。
  // 顶层窗口不做此重置：每个标签页本就独立、跨页导航理应累积来时路。
  if (inDrawer) {
    try {
      if (sessionStorage.getItem(JUMP_FLAG)) sessionStorage.removeItem(JUMP_FLAG) // 跳回落地 → 保留栈
      else sessionStorage.removeItem(STACK_KEY) // 全新打开 → 清栈
    } catch { /* ignore */ }
  }

  type Entry = { url: string; title: string; t: number }

  // 提取「同一个视频」标识：BV/av、番剧/课程 ep/ss、或 /list/ 播放页查询串里的 bvid
  const videoIdOf = (href: string): string => {
    try {
      const u = new URL(href, location.href)
      const p = u.pathname
      return p.match(/\/video\/(BV\w+|av\d+)/i)?.[1]?.toLowerCase()
        || p.match(/\/(?:bangumi|cheese)\/play\/((ep|ss)\d+)/i)?.[1]?.toLowerCase()
        || (u.searchParams.get('bvid') || '').toLowerCase()
        || ''
    } catch { return '' }
  }

  const readStack = (): Entry[] => {
    try { const a = JSON.parse(sessionStorage.getItem(STACK_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
  }
  const writeStack = (s: Entry[]): void => {
    try { sessionStorage.setItem(STACK_KEY, JSON.stringify(s.slice(-STACK_MAX))) } catch { /* 隐私模式/超限：放弃 */ }
  }

  // 剥掉标题串尾的站点后缀段（SPA 后 B 站会把 title 改成「_哔哩哔哩bilibili」等）
  const cleanTitle = (raw: string): string =>
    (raw || '').replace(/[_-](哔哩哔哩|bilibili|番剧|动画|电影|电视剧|纪录片|综艺|国创|在线观看|全集)([_-]?(哔哩哔哩|bilibili|番剧|动画|电影|电视剧|纪录片|综艺|国创|在线观看|全集))*$/i, '').trim()

  // 标题随 SPA 异步更新：盯 <title> 维护「视频 id → 已确认标题」，记录/展示按 id 取，杜绝张冠李戴
  const titleById = new Map<string, string>()
  const noteTitle = (): void => { const id = videoIdOf(location.href); const t = cleanTitle(document.title); if (id && t) titleById.set(id, t) }
  let titleEl: Element | null = null
  let headObserved = false
  const titleMo = new MutationObserver(() => {
    if (titleEl && !titleEl.isConnected) { titleEl = null; headObserved = false; titleMo.disconnect(); watchTitle() }
    noteTitle()
    updateNowRow() // 标题（异步）更新 → 同步刷新「正在播放」行，否则一直显示上一个视频名
  })
  function watchTitle(): void {
    if (document.head && !headObserved) { headObserved = true; titleMo.observe(document.head, { childList: true }) }
    const el = document.querySelector('title')
    if (el && el !== titleEl) { titleEl = el; titleMo.observe(el, { childList: true, characterData: true, subtree: true }); noteTitle() }
  }
  watchTitle()
  document.addEventListener('DOMContentLoaded', () => watchTitle())

  // 进度只认主播放器（页面可能有直播小窗/悬停预览等别的 <video>）
  let playerVideo: HTMLVideoElement | null = null
  const getVideo = (): HTMLVideoElement | null => (playerVideo && playerVideo.isConnected ? playerVideo : document.querySelector('video'))
  const currentVideoTime = (): number => { const v = getVideo(); return v && Number.isFinite(v.currentTime) ? v.currentTime : 0 }
  let lastPlayedT = 0
  document.addEventListener('timeupdate', (e) => {
    const v = e.target as HTMLVideoElement
    if (!(v && v.tagName === 'VIDEO' && Number.isFinite(v.currentTime))) return
    const inPlayer = !!v.closest('#bilibili-player, .bpx-player-container')
    if (inPlayer) playerVideo = v
    if ((inPlayer || !playerVideo) && v.currentTime > 0) lastPlayedT = v.currentTime
  }, true)
  const departureTime = (): number => { const t = currentVideoTime(); return t > 0 ? t : lastPlayedT }

  // 把「即将离开的视频」记入栈顶
  function recordEntry(prevHref: string, prevTitle: string, t: number, rerender = true): void {
    const id = videoIdOf(prevHref)
    if (!id) return
    const stack = readStack()
    if (stack.length && videoIdOf(stack[stack.length - 1].url) === id) return // 连续同视频去重
    stack.push({ url: prevHref, title: titleById.get(id) || cleanTitle(prevTitle) || id, t: resumeTime && t > 0 ? Math.floor(t) : 0 })
    const trimmed = stack.length > STACK_MAX ? stack.slice(-STACK_MAX) : stack
    writeStack(trimmed)
    if (rerender) renderChip(trimmed)
  }

  // 包一层 pushState：视频页 → 另一个视频页时，把离开的这个记入栈（只记不改，导航照原样进行）
  const origPush = history.pushState.bind(history)
  history.pushState = function (this: History, ...args: any[]) {
    try {
      const url = args[2]
      if (url != null) {
        const prevId = videoIdOf(location.href)
        const curId = videoIdOf(new URL(url, location.href).href)
        // ss→ep 是同一内容的 URL 规范化，不记；其余视频→视频才记
        if (prevId && curId && prevId !== curId && !(prevId.startsWith('ss') && curId.startsWith('ep'))) {
          recordEntry(location.href, document.title, departureTime())
          lastPlayedT = 0 // 上一个视频的进度已消费，别泄漏给下一条
        }
      }
    } catch { /* 与视频无关的 push，原样放行 */ }
    return origPush.apply(this, args as any)
  } as any

  // 兜底：pushState 包不住的整页离开（真·整页链接 / JS 赋值 location）。跳回自身的 replace 除外。
  let leavingViaJump = false
  window.addEventListener('pagehide', () => { if (!leavingViaJump) recordEntry(location.href, document.title, departureTime(), false) })

  // 跳回第 i 层：丢弃其上的层，replace 不增历史；t>5 才带续播点
  function jumpTo(i: number): void {
    const stack = readStack()
    if (i < 0) i = stack.length - 1
    const entry = stack[i]
    if (!entry) return
    writeStack(stack.slice(0, i))
    leavingViaJump = true
    let href = entry.url
    try { const u = new URL(entry.url, location.href); if (entry.t > 5) u.searchParams.set('t', String(entry.t)); href = u.href } catch { /* ignore */ }
    // 抽屉内跳回：补回抽屉标记（重载后仍隐顶栏/去广告、回程胶囊照常）+ 置 JUMP_FLAG，让重载后 init 不清栈
    if (drawerMark) { if (!href.includes('#')) href += drawerMark; try { sessionStorage.setItem(JUMP_FLAG, '1') } catch { /* ignore */ } }
    location.replace(href)
  }
  const jumpToUrl = (url: string): void => { const s = readStack(); for (let i = s.length - 1; i >= 0; i--) if (s[i].url === url) return jumpTo(i) }

  // 加载去重：栈顶与当前视频相同（刷新/原生返回/分P的 pagehide 记录）→ 弹掉
  function dedupeOnArrival(backRestore = false): void {
    const curId = videoIdOf(location.href)
    if (!curId) return
    let stack = readStack()
    const before = stack.length
    if (backRestore) { let i = stack.length - 1; while (i >= 0 && videoIdOf(stack[i].url) !== curId) i--; if (i >= 0) stack = stack.slice(0, i + 1) }
    let n = stack.length
    while (n && videoIdOf(stack[n - 1].url) === curId) n--
    if (n !== before) writeStack(stack.slice(0, n))
  }

  /* ---------------- 胶囊 UI（深浅色跟随系统） ---------------- */
  const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10H11"/></svg>'
  const CSS = `
.${NS}-root{ position:fixed; left:16px; bottom:24px; z-index:99990; font-family:-apple-system,"PingFang SC",sans-serif; }
.${NS}-chip{ display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 13px; border-radius:18px; cursor:pointer;
  background:rgba(22,23,28,.9); border:1px solid rgba(255,255,255,.1); color:#e3e5e7; box-shadow:0 3px 14px rgba(0,0,0,.3);
  font-size:13px; font-weight:500; opacity:.5; transition:opacity .18s ease, transform .16s ease;
  -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); }
.${NS}-root:hover .${NS}-chip{ opacity:1; }
.${NS}-chip:active{ transform:scale(.96); }
.${NS}-chip svg{ width:16px; height:16px; color:#fb7299; }
.${NS}-empty .${NS}-chip{ opacity:.32; cursor:default; }
.${NS}-empty .${NS}-chip svg{ color:rgba(255,255,255,.5); }
.${NS}-list{ position:absolute; left:0; bottom:calc(100% + 8px); width:290px;
  background:#1c1d22; border:1px solid rgba(255,255,255,.08); border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.5);
  opacity:0; visibility:hidden; transform:translateY(6px); pointer-events:none;
  /* 离开延迟 .15s 再淡出：给指针跨间隙迁移留宽限，不丢 hover */
  transition:opacity .16s ease .15s, transform .16s ease .15s, visibility 0s linear .31s; }
.${NS}-root:hover .${NS}-list{ opacity:1; visibility:visible; transform:none; pointer-events:auto; transition-delay:0s; }
/* 滚动收在内层，卡片自身不裁剪 → ::after 悬停桥才能伸出盒外（放 .list 上会被 overflow 裁掉=没有桥） */
.${NS}-scroll{ overflow:hidden auto; max-height:60vh; min-height:0; border-radius:12px; }
/* 胶囊与列表间隙的悬停桥：从卡片盒外伸出、指针穿过间隙仍算在列表上，hover 不断链 */
.${NS}-list::after{ content:''; position:absolute; top:100%; left:0; right:0; height:12px; }
.${NS}-head{ font-size:11px; color:rgba(255,255,255,.35); padding:9px 12px 5px; }
.${NS}-item{ display:flex; align-items:center; gap:9px; padding:8px 12px; cursor:pointer; }
.${NS}-item:hover{ background:rgba(251,114,153,.16); }
.${NS}-item:hover .${NS}-num{ background:#fb7299; color:#fff; }
.${NS}-item:hover .${NS}-title{ color:#fb7299; }
.${NS}-num{ flex:0 0 auto; width:19px; height:19px; border-radius:50%; background:rgba(255,255,255,.08); color:rgba(255,255,255,.55);
  font-size:11px; display:flex; align-items:center; justify-content:center; transition:background .14s ease, color .14s ease; }
.${NS}-title{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; color:rgba(255,255,255,.82); }
.${NS}-time{ flex:0 0 auto; font-size:11px; color:rgba(255,255,255,.4); font-variant-numeric:tabular-nums; }
/* 「正在播放」行（序号 0）：不可点、带动画声波条 */
.${NS}-now{ cursor:default; border-top:1px solid rgba(255,255,255,.06); }
.${NS}-now:hover{ background:none; }
.${NS}-now .${NS}-num{ background:rgba(255,255,255,.06); }
.${NS}-now:hover .${NS}-title{ color:rgba(255,255,255,.4); }
.${NS}-now .${NS}-title{ color:rgba(255,255,255,.4); }
.${NS}-bars{ flex:0 0 auto; display:flex; align-items:flex-end; gap:2px; height:12px; }
.${NS}-bars i{ width:2.5px; height:4px; background:#fb7299; border-radius:1px; }
.${NS}-playing .${NS}-bars i{ animation:${NS}-eq .9s ease-in-out infinite; }
.${NS}-playing .${NS}-bars i:nth-child(2){ animation-delay:.3s; }
.${NS}-playing .${NS}-bars i:nth-child(3){ animation-delay:.6s; }
@keyframes ${NS}-eq{ 0%,100%{ height:4px; } 50%{ height:12px; } }
@media (prefers-color-scheme: light){
  .${NS}-chip{ background:rgba(255,255,255,.95); border-color:rgba(0,0,0,.08); color:#18191c; box-shadow:0 3px 14px rgba(0,0,0,.14); }
  .${NS}-empty .${NS}-chip svg{ color:rgba(0,0,0,.35); }
  .${NS}-list{ background:#fff; border-color:rgba(0,0,0,.08); box-shadow:0 12px 40px rgba(0,0,0,.18); }
  .${NS}-head{ color:rgba(0,0,0,.4); }
  .${NS}-num{ background:rgba(0,0,0,.06); color:rgba(0,0,0,.5); }
  .${NS}-title{ color:rgba(0,0,0,.85); }
  .${NS}-time{ color:rgba(0,0,0,.4); }
  .${NS}-now{ border-top-color:rgba(0,0,0,.06); }
  .${NS}-now .${NS}-title, .${NS}-now:hover .${NS}-title{ color:rgba(0,0,0,.4); }
  .${NS}-now .${NS}-num{ background:rgba(0,0,0,.05); }
}
`

  let root: HTMLElement | null = null
  let listEl: HTMLElement | null = null
  let countEl: HTMLElement | null = null
  let nowRow: HTMLElement | null = null
  let nowTitleEl: HTMLElement | null = null

  const fmtTime = (t: number): string => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${s < 10 ? '0' : ''}${s}` }

  function ensureChip(): void {
    if (root || !document.body) return
    const style = document.createElement('style')
    style.textContent = CSS
    root = document.createElement('div')
    root.className = `${NS}-root`
    const list = document.createElement('div') // 卡片（无 overflow，::after 桥才伸得出去）
    list.className = `${NS}-list`
    const scroll = document.createElement('div') // 内层滚动容器，行都挂这里
    scroll.className = `${NS}-scroll`
    list.appendChild(scroll)
    listEl = scroll
    const chip = document.createElement('div')
    chip.className = `${NS}-chip`
    chip.title = '回退上一个视频（悬停看来时路）'
    chip.innerHTML = `${BACK_SVG}<span class="${NS}-count">0</span>`
    countEl = chip.querySelector(`.${NS}-count`)
    chip.addEventListener('click', () => { if (readStack().length) jumpTo(-1) })
    root.append(style, list, chip)
    // 指针离开后补一次被 hover 冻结的重建
    root.addEventListener('mouseleave', () => { if (rebuildHeldByHover) rebuildList() })
    document.body.appendChild(root)
  }

  function updateNowRow(): void {
    if (!nowRow || !nowTitleEl) return
    nowTitleEl.textContent = titleById.get(videoIdOf(location.href)) || cleanTitle(document.title) || '正在播放'
    const v = getVideo()
    nowRow.classList.toggle(`${NS}-playing`, !!v && !v.paused)
  }

  let rebuildQueued = false
  let rebuildHeldByHover = false
  function renderChip(known?: Entry[]): void {
    if (!document.body) return
    ensureChip()
    if (!root) return
    const stack = known || readStack()
    root.classList.toggle(`${NS}-empty`, !stack.length)
    if (countEl) countEl.textContent = String(stack.length)
    if (!rebuildQueued) { rebuildQueued = true; queueMicrotask(rebuildList) }
  }

  function rebuildList(): void {
    rebuildQueued = false
    if (!listEl || !root) return
    if (root.matches(':hover')) { rebuildHeldByHover = true; return } // 注视时冻结，避免行换位点错
    rebuildHeldByHover = false
    const stack = readStack()
    listEl.textContent = ''
    const head = document.createElement('div') // 始终有头：0 层给空态文案，不然只剩孤零零一条「正在播放」
    head.className = `${NS}-head`
    head.textContent = stack.length ? `来时路 · ${stack.length} 层` : '还没有来时路 · 当前是起点'
    listEl.appendChild(head)
    stack.forEach((entry, i) => {
      const item = document.createElement('div')
      item.className = `${NS}-item`
      item.title = entry.title
      const num = document.createElement('span')
      num.className = `${NS}-num`
      num.textContent = String(stack.length - i) // 序号 = 往回几层：最新一条(贴底)是 1
      const title = document.createElement('span')
      title.className = `${NS}-title`
      title.textContent = entry.title
      item.append(num, title)
      if (entry.t > 5) { const tm = document.createElement('span'); tm.className = `${NS}-time`; tm.textContent = fmtTime(entry.t); item.appendChild(tm) }
      item.addEventListener('click', () => jumpToUrl(entry.url))
      listEl!.appendChild(item)
    })
    // 序号 0 =「正在播放」，钉在最底部（紧贴胶囊）
    nowRow = document.createElement('div')
    nowRow.className = `${NS}-item ${NS}-now`
    const num = document.createElement('span')
    num.className = `${NS}-num`
    num.textContent = '0'
    nowTitleEl = document.createElement('span')
    nowTitleEl.className = `${NS}-title`
    const bars = document.createElement('span')
    bars.className = `${NS}-bars`
    bars.append(document.createElement('i'), document.createElement('i'), document.createElement('i'))
    nowRow.append(num, nowTitleEl, bars)
    listEl.appendChild(nowRow)
    updateNowRow()
    listEl.scrollTop = listEl.scrollHeight
  }

  // 播放态变化时更新声波条动画（不重建列表）
  document.addEventListener('play', updateNowRow, true)
  document.addEventListener('pause', updateNowRow, true)

  function onReady(backRestore = false): void { dedupeOnArrival(backRestore); renderChip() }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => onReady())
  else onReady()
  window.addEventListener('pageshow', (e) => { if (!e.persisted) return; leavingViaJump = false; onReady(true) })
}

export const wayBack: BiliKitModule = {
  id: 'way-back',
  name: '回程',
  description: '视频页左下角回退栈：记住来时路，点一下跳回上一个视频并续播（顶层与抽屉内都生效）',
  category: '播放',
  defaultEnabled: true,
  runAt: 'start', // 需在 B 站用 pushState 跳视频之前包上
  settings: [
    { key: 'resumeTime', type: 'toggle', label: '跳回时续播', default: true, hint: '跳回上一个视频时带上离开时的播放进度（?t=），从原处接着看' },
  ],
  init,
}
