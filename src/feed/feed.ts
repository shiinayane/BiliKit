import { fetchAppFeed, type FeedCard } from './app-api'
import { NS, BLANK } from './shared'
import { injectStyle, hideNativeChrome } from './styles'
import { makeCard, makeSkeleton } from './card'
import { mountControls } from './controls'

/**
 * App 推荐 feed 就地接管首页（编排层）：
 *  - 找到 B 站原生推荐流容器 → 隐藏 → 在原位挂我们自己的网格；
 *  - 窗口化：items[] 存全量数据，只渲染可视 ±1.5 屏的卡片节点、上下用占位撑高，DOM 数量有界；
 *  - 封面 IntersectionObserver 懒加载 + 屏外卸载（砍解码位图内存）；
 *  - 触底加载下一页；本会话 bvid 去重。
 * 样式/卡片/hover 预览/悬浮按钮已拆到 styles.ts / card.ts / hover-preview.ts / controls.ts。
 * 运行在隔离世界（@grant GM.xmlHttpRequest）——全程只操作 DOM，不读页面 JS。
 */
const seen = new Set<string>() // 已展示 bvid，去重
let grid: HTMLElement | null = null
let sentinel: HTMLElement | null = null
let topSpacer: HTMLElement | null = null // 窗口上方未渲染行的占位
let bottomSpacer: HTMLElement | null = null // 窗口下方未渲染行的占位
let loading = false
let exhausted = false // 匿名固定池刷完（连续多页无新内容）→ 停止并提示
let cardIo: IntersectionObserver | null = null
let sentinelIo: IntersectionObserver | null = null
let feedGen = 0 // 代际令牌：每次重新接管/刷新自增；在途 loadMore 察觉代际变化即作废，避免竞态写入新 grid
// 虚拟化地基（P1）：items 为全量数据真源，nodes 为「下标 → 已渲染卡片节点」。
// P1 阶段 render() 仍全量渲染（等价现状）；P2 起改为只渲染可视窗口。
const items: FeedCard[] = []
const nodes = new Map<number, HTMLElement>()
let cachedCols = 1 // 上次量到的有效列数（getComputedStyle 偶发返回未解析值时回落用）
let renderRaf = 0
let suppressScroll = false // 补偿 scrollBy 会触发一次 scroll 事件，用它跳过、免得再引发一轮 render
let cooldownUntil = 0 // 加载失败后的退避截止时刻（performance.now），期间不重试，避免疯狂打 API

function getAccessKey(): string {
  try {
    return (JSON.parse(localStorage.getItem('bilikit:settings') || '{}') as any)['feed.accessKey'] || ''
  } catch {
    return ''
  }
}

// 按页面真实底色(--bg2 亮度)判深浅——比 @media prefers-color-scheme 可靠（系统浅/B站深也能对）。
// 探针元素解析出 var(--bg2) 的实际 rgb，算感知亮度。骨架高光据此选亮/暗扫光。
let darkProbe: HTMLElement | null = null
function pageIsDark(): boolean {
  if (!darkProbe) {
    darkProbe = document.createElement('div')
    darkProbe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;background:var(--bg2,#fff);pointer-events:none'
    ;(document.body || document.documentElement).appendChild(darkProbe)
  }
  const m = getComputedStyle(darkProbe).backgroundColor.match(/\d+(?:\.\d+)?/g)
  if (!m) return false
  return 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2] < 128
}

// 量当前列数与「行高」（卡片高 + 行间距）。列数从 grid 计算样式取——正常已解析成 px 列表，逐个数；
// 偶发未解析(含 repeat/minmax 等非 px)则回落到上次有效值，防误判。行高量一张已渲染卡（卡等高，任取），无则回落。
function metrics(): { cols: number; rowH: number } {
  const cs = getComputedStyle(grid!)
  const parts = cs.gridTemplateColumns.split(' ').filter(Boolean)
  const cols = parts.length && parts.every((p) => p.endsWith('px')) ? parts.length : cachedCols
  cachedCols = cols
  let cardH = 330 // 首次未量到时的回落估值
  const first = nodes.size ? (nodes.values().next().value as HTMLElement) : null
  if (first && first.offsetHeight > 50) cardH = first.offsetHeight
  const rowGap = parseFloat(cs.rowGap) || 22
  return { cols, rowH: cardH + rowGap }
}

// 窗口化渲染：只保留「可视 ±1.5 屏」范围内的卡片节点，范围外移除；上下占位撑起未渲染区高度。
// 按 item 下标 key、只在窗口边缘增删（绝不中途拿一个节点换内容）→ 无封面重载/闪烁。
function render(): void {
  if (!grid || !sentinel || !topSpacer || !bottomSpacer) return
  if (!items.length) { topSpacer.style.height = '0px'; bottomSpacer.style.height = '0px'; return }
  const { cols, rowH } = metrics()
  const totalRows = Math.ceil(items.length / cols)
  const gridTop = grid.getBoundingClientRect().top + window.scrollY // grid 在文档中的顶偏移
  const into = window.scrollY - gridTop // 已滚进 grid 的像素（负=grid 还在视口下方）
  const vh = window.innerHeight
  const BUF = vh * 1.5 // 视口上下各留 1.5 屏 buffer（封面提前加载，无 pop-in）
  const firstRow = Math.max(0, Math.floor((into - BUF) / rowH))
  const lastRow = Math.min(totalRows - 1, Math.max(0, Math.ceil((into + vh + BUF) / rowH)))
  const startIdx = firstRow * cols
  const endIdx = Math.min(items.length, (lastRow + 1) * cols) // 独占上界

  // 锚点补偿：仅当「窗口上方有占位」(firstRow>0) 时需要——顶部(首屏/刷新)时 firstRow=0 不补偿，
  // 免得与 refreshFeed 的 scrollTo(top) 打架、也不会误落在非顶部。
  // 单点锚：几何推出「当前视口顶那一行的首卡」(O(1))，避免每帧遍历全窗口读 BCR 造成布局抖动。
  const anchor = firstRow > 0 ? nodes.get(Math.max(0, Math.floor(into / rowH)) * cols) || null : null
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0

  // 1) 移除窗口外节点（连同 observer/监听器/闭包一起 GC）
  for (const [i, el] of nodes) {
    if (i < startIdx || i >= endIdx) { cardIo?.unobserve(el); el.remove(); nodes.delete(i) }
  }
  // 2) 占位高度 = 未渲染行数 × 行高
  topSpacer.style.height = firstRow * rowH + 'px'
  bottomSpacer.style.height = Math.max(0, (totalRows - (lastRow + 1)) * rowH) + 'px'
  // 3) 补齐窗口内缺失节点：升序建卡，插到「下一个更高的已存在节点」前，否则底部占位前 → 保持顺序
  for (let i = startIdx; i < endIdx; i++) {
    if (nodes.has(i)) continue
    const el = makeCard(items[i])
    nodes.set(i, el)
    let ref: HTMLElement = bottomSpacer
    for (let j = i + 1; j < endIdx; j++) { const n = nodes.get(j); if (n) { ref = n; break } }
    grid.insertBefore(el, ref)
    cardIo?.observe(el)
  }
  // 4) 补偿：锚点渲染后若位移 >0.5px，反向滚回保持可见内容不动（同帧完成，无中间态）。
  //    置 suppressScroll 跳过这次 scrollBy 触发的 scroll，免得再引发一轮 render（估算准时 delta≈0，通常不触发）。
  if (anchor) {
    const delta = anchor.getBoundingClientRect().top - anchorTop
    if (Math.abs(delta) > 0.5) { suppressScroll = true; window.scrollBy(0, delta) }
  }
}

// scroll/resize 用 rAF 节流地重算窗口
function scheduleRender(): void {
  if (suppressScroll) { suppressScroll = false; return } // 跳过补偿 scrollBy 自己触发的这次 scroll
  if (renderRaf) return
  renderRaf = requestAnimationFrame(() => { renderRaf = 0; render() })
}

// 清空全部已渲染卡片与数据（刷新/重新接管时用）
function clearAll(): void {
  if (cardIo) cardIo.disconnect() // 解除对旧卡的观察，避免 observer 持有已删除节点（泄漏）
  for (const el of nodes.values()) el.remove()
  nodes.clear()
  items.length = 0
  if (topSpacer) topSpacer.style.height = '0px'
  if (bottomSpacer) bottomSpacer.style.height = '0px'
}

function renderSkeletons(n: number): void {
  if (!grid || !bottomSpacer) return
  const frag = document.createDocumentFragment()
  for (let i = 0; i < n; i++) frag.appendChild(makeSkeleton())
  grid.insertBefore(frag, bottomSpacer) // 骨架落在两占位之间（此时占位高度为 0）
}

function clearSkeletons(): void {
  if (grid) grid.querySelectorAll(`.${NS}-skcard`).forEach((n) => n.remove())
}

// 哨兵是否还在「加载区」内。填充目标必须 > 哨兵 IO 的触发区(innerH+1000)，否则填完哨兵仍在 IO 区内、
// IO 不再产生跨越事件 → 触底加载卡住。取 innerH + max(innerH, 1200)：大屏≈两屏、短屏也稳超触发区。
function sentinelInView(): boolean {
  if (!sentinel) return false
  return sentinel.getBoundingClientRect().top < window.innerHeight + Math.max(window.innerHeight, 1200)
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
  if (performance.now() < cooldownUntil) return // 上次失败后的退避期内不重试，避免持续错误时疯狂打 API
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
      // 新卡去重后推入 items（数据真源），再 render() 落成节点（P1 全量）
      let addedThisPage = 0
      for (const c of cards) {
        if (!c.bvid || seen.has(c.bvid)) continue
        seen.add(c.bvid)
        if (seen.size > 2000) seen.delete(seen.values().next().value as string) // 上限 2000，超出淘汰最老（防长会话无限增长）
        items.push(c)
        addedThisPage++
      }
      if (addedThisPage) render()
      emptyStreak = addedThisPage === 0 ? emptyStreak + 1 : 0
    }
    if (emptyStreak >= 3) {
      if (getAccessKey()) {
        // 已登录不应「刷完」：多为瞬时空/重复页，不永久锁死，退避几秒后由滚动自然重试
        cooldownUntil = performance.now() + 3000
      } else {
        // 匿名池确实是固定内容，连续 3 页无新 → 锁死并提示
        exhausted = true
        showTip('匿名推荐已刷完（B 站给匿名请求的是固定内容池）。配置 access_key 可看个性化、不重复的推荐。')
      }
    }
  } catch (e) {
    console.error('[BiliKit Feed] 加载出错：', e)
    failed = true
  } finally {
    if (gen === feedGen) {
      clearSkeletons()
      loading = false
      if (failed) cooldownUntil = performance.now() + 3000 // 失败退避：3s 内哨兵/滚动重触发也不重试
    } // 仅当仍是本代才清理，别踩到新一轮的状态
  }
  // 首屏就失败（一张真实卡都没有）时给出可见提示，而不是空白/永久骨架
  if (gen === feedGen && failed && !hasRealCard()) showTip('加载失败，请稍后重试；若持续失败可在设置里配置 access_key 或检查网络。')
}

// 刷新内容：清空当前卡片 + 重置去重/耗尽 → 回顶 → 重新拉。
function refreshFeed(btn?: HTMLElement): void {
  if (!grid || !sentinel) return
  feedGen++ // 作废在途的 loadMore，使刷新即便在加载中也能立即生效（不再静默失效）
  loading = false
  clearAll() // 清掉全部卡片节点 + items + 解除观察
  removeTip()
  seen.clear()
  exhausted = false
  cooldownUntil = 0 // 手动刷新清退避，立即重试
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
  nodes.clear() // 旧节点随旧 grid 已移除，清掉映射与数据（新 grid 从空开始）
  items.length = 0
  seen.clear()
  exhausted = false
  cooldownUntil = 0

  injectStyle()
  native.style.setProperty('display', 'none', 'important')

  // 封面懒加载/屏外卸载：卡进视口前 1000px 载图，远离(仍在窗口内)则卸成 BLANK 释放位图。
  // 窗口化已负责增删节点，这里只管窗口内节点的封面位图内存。
  cardIo = new IntersectionObserver(
    (ents) => {
      for (const e of ents) {
        const card = e.target as HTMLElement
        const img = card.querySelector('img') as HTMLImageElement | null
        if (e.isIntersecting) {
          if (img && (!img.getAttribute('src') || img.src.startsWith('data:')) && img.dataset.src) {
            img.parentElement?.classList.remove('failed') // 重新加载 → 清掉上次的失败态，给一次重试
            img.src = img.dataset.src
          }
        } else {
          if (img && img.src && !img.src.startsWith('data:')) img.src = BLANK
        }
      }
    },
    { rootMargin: '1000px 0px' },
  )

  grid = document.createElement('div')
  grid.className = NS
  grid.classList.toggle('bk-dark', pageIsDark()) // 骨架高光按真实底色选亮/暗扫光
  topSpacer = document.createElement('div'); topSpacer.className = `${NS}-spacer`
  bottomSpacer = document.createElement('div'); bottomSpacer.className = `${NS}-spacer`
  sentinel = document.createElement('div'); sentinel.className = `${NS}-sentinel`
  // 顺序：上占位 → (卡片) → 下占位 → 哨兵。卡片由 render() 插在两占位之间。
  grid.append(topSpacer, bottomSpacer, sentinel)
  native.parentElement.insertBefore(grid, native)

  sentinelIo = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore() }, { rootMargin: '1000px 0px' })
  sentinelIo.observe(sentinel)

  mountControls((btn) => refreshFeed(btn)) // 右下角：刷新内容 + 返回顶部
  renderSkeletons(12) // 数据到达前先铺骨架占位，避免空白
  loadMore() // 循环内会一直拉到填满首屏（哨兵离开加载区）
  return true
}

const REPO = 'https://github.com/shiinayane/BiliKit'

// 未检测到 Core → 顶部插一条可关闭提示条（登录/设置/抽屉净化都靠 Core）。记住关闭，不再骚扰。
function warnCoreMissing(): void {
  if (!grid || !topSpacer) return
  if (localStorage.getItem('bilikit:dismiss.core-missing') || grid.querySelector(`.${NS}-warn`)) return
  const bar = document.createElement('div')
  bar.className = `${NS}-warn`
  bar.innerHTML =
    `<span>未检测到 <b>BiliKit Core</b>：登录、设置、抽屉净化都需要它。</span>` +
    `<a href="${REPO}" target="_blank" rel="noopener">前往安装</a>` +
    `<button class="bk-x" aria-label="关闭">✕</button>`
  bar.querySelector('.bk-x')!.addEventListener('click', () => {
    try { localStorage.setItem('bilikit:dismiss.core-missing', '1') } catch { /* 隐私模式忽略 */ }
    bar.remove()
  })
  grid.insertBefore(bar, topSpacer) // 置顶；窗口渲染只管两占位之间，不动它
}

// Core 心跳新鲜 = 已安装并在跑；否则提示安装
function checkCore(): void {
  const alive = Number(localStorage.getItem('bilikit:alive.core') || 0)
  if (Date.now() - alive > 15000) warnCoreMissing()
}

/** 只在首页顶层窗口生效；SPA 出入首页后原生流可能重建，轮询补挂。 */
export function mountFeed(): void {
  if (window.top !== window.self) return
  try { localStorage.setItem('bilikit:alive.feed', String(Date.now())) } catch { /* 隐私模式忽略 */ } // 心跳，供 Core 探测
  // 窗口化：滚动/改窗都重算可视范围（rAF 节流；render 内部有 grid 空判）
  window.addEventListener('scroll', scheduleRender, { passive: true })
  window.addEventListener('resize', scheduleRender)
  const onHome = () => location.pathname === '/' || location.pathname === '/index.html'
  const tick = () => { if (onHome()) { hideNativeChrome(); takeover() } }
  tick()
  setTimeout(() => { if (onHome()) checkCore() }, 2500) // 延迟等 Core 心跳就位后再判断是否缺失
  let tries = 0
  const t = setInterval(() => {
    if (!onHome()) return
    try { localStorage.setItem('bilikit:alive.feed', String(Date.now())) } catch { /* ignore */ } // 刷新心跳，供 Core 面板实时探测
    hideNativeChrome()
    if (takeover()) { /* 挂上了；仍继续轮询以应对 SPA 重建 */ }
    if (grid) grid.classList.toggle('bk-dark', pageIsDark()) // 跟随主题切换实时更新深浅
    if (++tries > 600) clearInterval(t) // ~10min 后停轮询兜底
  }, 1000)
}
