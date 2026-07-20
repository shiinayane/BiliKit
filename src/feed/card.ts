import { NS, esc, coverUrl, coverSized, readSetting } from './shared'
import { setupHoverPreview } from './hover-preview'
import { setupVideoPreview } from './video-preview'
import { watchLaterAdd, watchLaterDel, dislikeVideo, undoDislikeVideo, toast } from './actions'
import type { FeedCard, DislikeReason } from './app-api'
import {
  DEFAULT_NEW_TAB_HISTORY_FLATTEN,
  DEFAULT_OPEN_MODE,
  NEW_TAB_HISTORY_FLATTEN_KEY,
  openBiliKitVideoTab,
} from '../core/new-tab'

// 封面遮罩的播放/弹幕图标（跟随 currentColor=白）
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const DM_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 16H9l-5 4V5.5A1.5 1.5 0 0 1 5.5 4z"/></svg>'
// 稍后再看=闹钟；三点=竖向三点；撤销=逆时针箭头
const WL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 1.95-5.05"/><path d="M4 3.5V7h3.5"/><path d="M10.5 9l4.3 3-4.3 3z" fill="currentColor" stroke="none"/></svg>'
const WL_DONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
const MORE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>'
const UNDO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.6-7.6L3 8"/></svg>'
const stripUnit = (s: string) => s.replace(/观看|播放|弹幕|次/g, '').trim() // 遮罩上有图标，去掉文字单位

// 从条目自带的 three_point.dislike_reasons 里挑「不感兴趣」「不想看此UP主」两项（按真实数据匹配，不硬编码顺序）。
// 真机样本形如：{id:4,name:"UP主:夏花…"}, {id:12,"此类内容过多"}, {id:13,"推荐过"}, {id:1,"这个内容"}。
//   · 不想看此UP主 = 名字以「UP主」开头那条（id 4）。
//   · 不感兴趣    = 「这个内容」那条（id 1，泛指此视频）；名字不含「不感兴趣」字样，故按 id 1 / 名字 / 排除 UP 兜底。
// 无匹配则该项不出现；两项都无 → 不显三点菜单。
function pickReasons(rs: DislikeReason[]): { notInterest?: DislikeReason; upper?: DislikeReason } {
  const upper = rs.find((r) => /^\s*up\s*主/i.test(r.name)) || rs.find((r) => /(作者|视频主)/.test(r.name))
  const notInterest =
    rs.find((r) => r.id === 1) ||
    rs.find((r) => /不感兴趣|这个内容/.test(r.name)) ||
    rs.find((r) => r !== upper)
  return { notInterest, upper }
}

// 建一张视频卡（不 observe——observe 由 render() 在插入 DOM 后统一做）
export function makeCard(c: FeedCard, beforeCurrentNavigation?: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = `${NS}-card`
  if (c.bvid) el.dataset.bvid = c.bvid // 供 Core「全站抽屉」识别 → 按「打开方式」打开（Feed 不再自管视频打开）
  // 封面遮罩左侧：播放 + 弹幕（带图标；缺项省略）
  const mstat =
    (c.play ? `<span>${PLAY_SVG}${esc(stripUnit(c.play))}</span>` : '') +
    (c.danmaku ? `<span>${DM_SVG}${esc(stripUnit(c.danmaku))}</span>` : '')
  // 推荐理由小徽章（如「已关注」）放在 UP 名之前，学 Gate 的行内 pill，统一用品牌色描边；
  // 名字+日期单独一段以便省略号；整行 flex 居中对齐徽章与文字。
  const badge = c.reason ? `<span class="${NS}-badge">${esc(c.reason)}</span>` : ''
  // UP 名单独包一层 .bk-feed-up（可点进空间）；日期不可点
  const who = `<span class="${NS}-up">${esc(c.up)}</span>` + (c.date ? `<i>·</i>${esc(c.date)}` : '')
  const sub = badge + `<span class="${NS}-who">${who}</span>`
  // 稍后再看按钮（封面右上角，hover 现）；三点「我不想看」菜单（标题右侧，hover 展子菜单）——
  // 都带 .bk-feed-noopen：Core 全站抽屉据此放行、不当成「点视频打开」。
  const wlBtn = c.bvid ? `<button class="${NS}-wl ${NS}-noopen" type="button" title="稍后再看" aria-label="稍后再看">${WL_SVG}</button>` : ''
  const { notInterest, upper } = pickReasons(c.dislikeReasons || [])
  const menu = (notInterest || upper)
    ? `<div class="${NS}-more-wrap ${NS}-noopen">` +
        `<button class="${NS}-more" type="button" title="我不想看" aria-label="我不想看">${MORE_SVG}</button>` +
        `<div class="${NS}-menu">` +
          (notInterest ? `<button class="${NS}-mi" type="button" data-rid="${notInterest.id}" data-lbl="不感兴趣">不感兴趣</button>` : '') +
          (upper ? `<button class="${NS}-mi" type="button" data-rid="${upper.id}" data-lbl="不想看此UP主">不想看此UP主</button>` : '') +
        `</div>` +
      `</div>`
    : ''
  const overlay =
    `<div class="${NS}-dov ${NS}-noopen"><div class="${NS}-dov-in">` +
    `<div class="${NS}-dov-txt"></div>` +
    `<button class="${NS}-undo" type="button">${UNDO_SVG}<span>撤销</span></button>` +
    `</div></div>`
  // 封面用 <picture> 做 AVIF/WEBP 格式协商（同尺寸下比 JPEG 小 27%~45%，见 shared.ts coverSized 实测数据）。
  // <source> 的 srcset 和 <img> 的 src 一样得**懒加载/屏外卸载**——都用 data-* 占位、由 feed.ts 的 IO
  // 回调统一按「进视口才填、离视口即清」处理；若 <picture> 一插入 DOM 就给 <source> 填了真实 srcset，
  // 浏览器会立即触发取图（不等 <img> 的 src），等于绕过了懒加载，白白提前拉一堆图——因此两者必须同步懒加载。
  const cov = coverSized(c.cover)
  const pic =
    `<picture>` +
    `<source type="image/avif" data-srcset="${esc(cov.avif)}">` +
    `<source type="image/webp" data-srcset="${esc(cov.webp)}">` +
    `<img alt="" data-src="${esc(cov.jpg)}" decoding="async">` +
    `</picture>`
  el.innerHTML =
    `<div class="${NS}-cover">${pic}` +
    `<div class="${NS}-mask"><div class="${NS}-mstat">${mstat}</div>` +
    (c.duration ? `<span>${esc(c.duration)}</span>` : '<span></span>') +
    `</div>` + wlBtn +
    `</div>` +
    `<div class="${NS}-bottom">` +
    (c.face ? `<img class="${NS}-face" src="${esc(coverUrl(c.face))}" alt="" loading="lazy" decoding="async">` : `<div class="${NS}-face"></div>`) +
    `<div class="${NS}-right">` +
    `<div class="${NS}-title">${esc(c.title)}</div>` +
    `<div class="${NS}-sub">${sub}${menu}</div>` + // 三点菜单随 UP名·日期行、右对齐常显
    `</div></div>` +
    overlay
  // 封面完全加载后才淡入（撤骨架微光）；卸载成 BLANK 时移除 .loaded → 微光回来
  const coverEl = el.querySelector(`.${NS}-cover`) as HTMLElement
  const imgEl = el.querySelector('img') as HTMLImageElement
  imgEl.addEventListener('load', () => {
    coverEl.classList.toggle('loaded', !imgEl.src.startsWith('data:'))
  })
  // 封面 404/解码失败：标 .failed 停微光、露灰底，避免那张卡无限转骨架
  imgEl.addEventListener('error', () => { if (!imgEl.src.startsWith('data:')) coverEl.classList.add('failed') })
  // 封面 hover 预览：真视频（默认，低清 dash 静音自动播）/ 雪碧图 / 关闭——面板 feed.previewMode 可切
  if (c.bvid) {
    const pm = readSetting<string>('feed.previewMode', 'video')
    if (pm === 'sprite') setupHoverPreview(coverEl, c.bvid)
    else if (pm !== 'off') setupVideoPreview(coverEl, c.bvid, c.cid)
  }
  // —— 稍后再看（可再点切换：已加入→移出）——
  const wlEl = el.querySelector(`.${NS}-wl`) as HTMLElement | null
  if (wlEl) wlEl.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (wlEl.classList.contains('busy')) return
    const added = wlEl.classList.contains('done')
    wlEl.classList.add('busy')
    const r = added ? await watchLaterDel(c.aid) : await watchLaterAdd(c.aid)
    wlEl.classList.remove('busy')
    if (!r.ok) { toast(r.message || (added ? '移出失败' : '添加失败')); return }
    if (added) { wlEl.innerHTML = WL_SVG; wlEl.classList.remove('done'); wlEl.title = '稍后再看'; toast('已移出稍后再看') }
    else { wlEl.innerHTML = WL_DONE_SVG; wlEl.classList.add('done'); wlEl.title = '已加入稍后再看（再点移出）'; toast('已添加到稍后再看') }
  })

  // —— 我不想看：菜单 + 提交 + 卡片模糊浮层 + 撤销 ——
  const moreWrap = el.querySelector(`.${NS}-more-wrap`) as HTMLElement | null
  if (moreWrap) {
    let lastRid = c.dislikedRid || 0 // 记住本次提交的 reason_id，撤销时回传（重建时从数据恢复）
    const moreBtn = moreWrap.querySelector(`.${NS}-more`) as HTMLElement
    // 触屏无 hover：点击也能开。同步给卡片 .menuopen（抬 z-index，菜单不被下方卡片盖住；桌面 hover 另有 :hover 兜底）
    const setOpen = (on: boolean) => { moreWrap.classList.toggle('open', on); el.classList.toggle('menuopen', on) }
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!moreWrap.classList.contains('open')) })
    el.querySelectorAll(`.${NS}-mi`).forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const btn = b as HTMLElement
      const rid = Number(btn.dataset.rid)
      const lbl = btn.dataset.lbl || '已标记不想看'
      setOpen(false)
      const r = await dislikeVideo(c, rid)
      if (!r.ok) { toast(r.message || '提交失败'); return }
      lastRid = rid
      // 标记态写进数据（随 items[] 存活）——卸载重建时据此恢复，不然划走再回来就变回普通卡
      c.disliked = true; c.dislikedRid = rid; c.dislikedLbl = lbl
      ;(el.querySelector(`.${NS}-dov-txt`) as HTMLElement).textContent = lbl
      el.classList.add('disliked')
    }))
    const undoEl = el.querySelector(`.${NS}-undo`) as HTMLElement
    undoEl.addEventListener('click', (e) => {
      e.stopPropagation()
      c.disliked = false // 撤销标记态（同步数据，重建时不再恢复浮层）
      el.classList.remove('disliked') // 乐观回退，UI 立即恢复
      undoDislikeVideo(c, lastRid).then((r) => { if (!r.ok) toast(r.message || '撤销失败') })
    })
    // 重建恢复：卡片曾被标「不想看」→ 重建时（此刻）把浮层文案 + .disliked 恢复出来
    if (c.disliked) {
      ;(el.querySelector(`.${NS}-dov-txt`) as HTMLElement).textContent = c.dislikedLbl || '已标记不想看'
      el.classList.add('disliked')
    }
  }

  el.addEventListener('click', (e) => {
    // 点头像或 UP 名 → 进 UP 空间（始终新标签；Core 全站抽屉会跳过这块）
    if (c.mid && (e.target as HTMLElement).closest(`.${NS}-face, .${NS}-up`)) {
      window.open(`https://space.bilibili.com/${c.mid}`, '_blank', 'noopener')
      return
    }
    // 视频卡（有 bvid）：抽屉 / 网页全屏 / 新标签模式由 Core「全站抽屉」在捕获阶段接管（stopImmediatePropagation，
    // 本 handler 不会执行到这）。走到这里 = 当前页模式，或 Core 缺失/太旧未接管 → 按 openMode 兜底打开，绝不「点了没反应」。
    if (c.bvid) {
      const url = `https://www.bilibili.com/video/${c.bvid}`
      if (readSetting<string>('feed.openMode', DEFAULT_OPEN_MODE) === 'current') {
        beforeCurrentNavigation?.()
        location.href = url
      }
      else openBiliKitVideoTab(
        url,
        readSetting<boolean>(NEW_TAB_HISTORY_FLATTEN_KEY, DEFAULT_NEW_TAB_HISTORY_FLATTEN),
      )
      return
    }
    // 非视频卡（直播 / 文章等，只有 uri）：直接新标签打开
    if (c.uri && /^https?:\/\//i.test(c.uri)) window.open(c.uri, '_blank', 'noopener')
  })
  return el // 注意：observe 要等插入 DOM 后再做（Safari 下观察未连接元素不可靠）
}

// 骨架占位卡：数据未到时先铺满首屏，避免空白。纯 shimmer，无图片、不被 IO 观察。
export function makeSkeleton(): HTMLElement {
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
