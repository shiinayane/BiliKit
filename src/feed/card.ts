import { NS, esc, coverUrl, readSetting } from './shared'
import { setupHoverPreview } from './hover-preview'
import { setupVideoPreview } from './video-preview'
import { openDrawer, preconnect } from './drawer'
import type { FeedCard } from './app-api'

// 封面遮罩的播放/弹幕图标（跟随 currentColor=白）
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const DM_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 16H9l-5 4V5.5A1.5 1.5 0 0 1 5.5 4z"/></svg>'
const stripUnit = (s: string) => s.replace(/观看|播放|弹幕|次/g, '').trim() // 遮罩上有图标，去掉文字单位

// 建一张视频卡（不 observe——observe 由 render() 在插入 DOM 后统一做）
export function makeCard(c: FeedCard): HTMLElement {
  const el = document.createElement('div')
  el.className = `${NS}-card`
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
  el.addEventListener('mouseenter', preconnect) // 悬停预连接 B站主机（内部 12s 节流），点开更快
  el.addEventListener('click', (e) => {
    // 点头像或 UP 名 → 进 UP 空间（始终新标签，不进抽屉）
    if (c.mid && (e.target as HTMLElement).closest(`.${NS}-face, .${NS}-up`)) {
      window.open(`https://space.bilibili.com/${c.mid}`, '_blank', 'noopener')
      return
    }
    const url = c.bvid ? `https://www.bilibili.com/video/${c.bvid}` : c.uri
    if (!url || !/^https?:\/\//i.test(url)) return // 只开 http(s)，防 javascript:/开放重定向
    // 打开方式：面板设置 feed.openMode（默认新标签页）。抽屉仅对可 iframe 的视频页用。
    const mode = readSetting<string>('feed.openMode', 'drawer')
    if (mode === 'current') location.href = url
    // drawer-web：同抽屉，但让 iframe 内的播放器自动进「网页全屏」，铺满抽屉、隐评论/推荐（沉浸）
    // feed.drawerImmersive（默认开）：网页全屏时是否延迟揭幕（遮罩留到铺满再撤，藏过渡）
    else if ((mode === 'drawer' || mode === 'drawer-web') && c.bvid) {
      const web = mode === 'drawer-web'
      openDrawer(url, coverUrl(c.cover), web, web && readSetting<boolean>('feed.drawerImmersive', true)) // 封面作加载遮罩的模糊铺底
    }
    else window.open(url, '_blank', 'noopener')
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
