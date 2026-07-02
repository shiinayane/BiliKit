import { NS, coverUrl } from './shared'
import { gmRequest } from './app-api'

/**
 * 封面 hover 预览：拉 videoshot 雪碧图，rAF + 固定总时长自动轮播；底部进度条随播放推进。
 * sprite 在 bimp.hdslb.com（海外首拉慢、无可用镜像），按 bvid 缓存，缓存后秒出。
 */
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
export function setupHoverPreview(cover: HTMLElement, bvid: string): void {
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
    // 窗口化可能在无 mouseleave 的情况下移除本卡（滚轮/键盘滚走）→ 节点脱离 DOM 就自停，避免 rAF 永久空转泄漏
    if (!cover.isConnected) { stop(); return }
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
