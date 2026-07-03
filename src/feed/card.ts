import { NS, esc, coverUrl, readSetting } from './shared'
import { setupHoverPreview } from './hover-preview'
import { setupVideoPreview } from './video-preview'
import type { FeedCard } from './app-api'

// 封面遮罩的播放/弹幕图标（跟随 currentColor=白）
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const DM_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 16H9l-5 4V5.5A1.5 1.5 0 0 1 5.5 4z"/></svg>'
const stripUnit = (s: string) => s.replace(/观看|播放|弹幕|次/g, '').trim() // 遮罩上有图标，去掉文字单位

// 建一张视频卡（不 observe——observe 由 render() 在插入 DOM 后统一做）
export function makeCard(c: FeedCard): HTMLElement {
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
  // 封面 hover 预览：真视频（默认，低清 dash 静音自动播）/ 雪碧图 / 关闭——面板 feed.previewMode 可切
  if (c.bvid) {
    const pm = readSetting<string>('feed.previewMode', 'video')
    if (pm === 'sprite') setupHoverPreview(coverEl, c.bvid)
    else if (pm !== 'off') setupVideoPreview(coverEl, c.bvid, c.cid)
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
      if (readSetting<string>('feed.openMode', 'drawer') === 'current') location.href = url
      else window.open(url, '_blank', 'noopener')
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
