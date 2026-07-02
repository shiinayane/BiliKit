import { fetchAppFeed, type FeedCard } from './app-api'
import { NS, BLANK } from './shared'
import { injectStyle, hideNativeChrome } from './styles'
import { makeCard, makeSkeleton } from './card'
import { mountControls } from './controls'

/**
 * App 推荐 feed 就地接管首页（编排层）：
 *  - 找到 B 站原生推荐流容器 → 隐藏 → 在原位挂我们自己的网格；
 *  - 纯 DOM 卡 + content-visibility:auto（屏外自动跳过布局/绘制，Safari 友好、不闪屏）；
 *  - 封面 IntersectionObserver 懒加载 + 屏外卸载（砍解码位图内存）；
 *  - 触底加载下一页；本会话 bvid 去重。
 * 样式/卡片/hover 预览/悬浮按钮已拆到 styles.ts / card.ts / hover-preview.ts / controls.ts。
 * 运行在隔离世界（@grant GM.xmlHttpRequest）——全程只操作 DOM，不读页面 JS。
 */
const seen = new Set<string>() // 已展示 bvid，去重
let grid: HTMLElement | null = null
let sentinel: HTMLElement | null = null
let loading = false
let exhausted = false // 匿名固定池刷完（连续多页无新内容）→ 停止并提示
let cardIo: IntersectionObserver | null = null
let sentinelIo: IntersectionObserver | null = null
let feedGen = 0 // 代际令牌：每次重新接管/刷新自增；在途 loadMore 察觉代际变化即作废，避免竞态写入新 grid
// 虚拟化地基（P1）：items 为全量数据真源，nodes 为「下标 → 已渲染卡片节点」。
// P1 阶段 render() 仍全量渲染（等价现状）；P2 起改为只渲染可视窗口。
const items: FeedCard[] = []
const nodes = new Map<number, HTMLElement>()

function getAccessKey(): string {
  try {
    return (JSON.parse(localStorage.getItem('bilikit:settings') || '{}') as any)['feed.accessKey'] || ''
  } catch {
    return ''
  }
}

// 把 items 落成卡片节点。P1：全量渲染——为尚未建节点的下标建节点、插到哨兵前、连接后再 observe。
// P2 起改为按可视窗口增删。
function render(): void {
  if (!grid || !sentinel) return
  const frag = document.createDocumentFragment()
  const fresh: HTMLElement[] = []
  for (let i = 0; i < items.length; i++) {
    if (nodes.has(i)) continue
    const el = makeCard(items[i])
    nodes.set(i, el)
    fresh.push(el)
    frag.appendChild(el)
  }
  if (fresh.length) {
    grid.insertBefore(frag, sentinel)
    if (cardIo) for (const el of fresh) cardIo.observe(el) // 连接进 DOM 后再观察（Safari 下观察未连接元素不可靠）
  }
}

// 清空全部已渲染卡片与数据（刷新/重新接管时用）
function clearAll(): void {
  if (cardIo) cardIo.disconnect() // 解除对旧卡的观察，避免 observer 持有已删除节点（泄漏）
  for (const el of nodes.values()) el.remove()
  nodes.clear()
  items.length = 0
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

// 哨兵是否还在「加载区」内——填充目标按屏高成比例（约两屏）。大屏自动多拉几页、不显得稀疏。
function sentinelInView(): boolean {
  if (!sentinel) return false
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
      // 新卡去重后推入 items（数据真源），再 render() 落成节点（P1 全量）
      let addedThisPage = 0
      for (const c of cards) {
        if (!c.bvid || seen.has(c.bvid)) continue
        seen.add(c.bvid)
        items.push(c)
        addedThisPage++
      }
      if (addedThisPage) render()
      emptyStreak = addedThisPage === 0 ? emptyStreak + 1 : 0
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

// 刷新内容：清空当前卡片 + 重置去重/耗尽 → 回顶 → 重新拉。
function refreshFeed(btn?: HTMLElement): void {
  if (!grid || !sentinel) return
  feedGen++ // 作废在途的 loadMore，使刷新即便在加载中也能立即生效（不再静默失效）
  loading = false
  clearAll() // 清掉全部卡片节点 + items + 解除观察
  removeTip()
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

  mountControls((btn) => refreshFeed(btn)) // 右下角：刷新内容 + 返回顶部
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
