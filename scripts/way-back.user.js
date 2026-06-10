// ==UserScript==
// @name         BiliKit · 回程
// @name:en      BiliKit · Way Back
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.1.0
// @description    视频标签页历史不再堆积：跨视频跳转压扁为 replace，一次返回穿透回列表；无路可退时左滑甩动两次关闭标签页，回到来处。
// @description:en Keep video-tab history flat (cross-video jumps use replace, one back returns to the list) and double-flick to close the tab when there is nothing to go back to.
// @author       shiinayane
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * 解决的场景：原生新标签页打开视频后连续跳视频，历史堆成一摞，
 * 返回手势一格格退、退到底也回不到列表（列表在另一个标签页），出口只剩手动关标签页。
 *
 * 两件套：
 * 1. 历史压扁 —— 跨视频跳转（链接点击 / SPA pushState）一律 replace 化，历史深度不增长。
 *    同标签页从列表点进来的场景同样受益：一次原生返回直接穿透回列表。
 *    同一视频内的分 P 切换保留 push，不破坏分 P 返回语义。
 * 2. 甩动关闭 —— 仅当「无路可退」（canGoBack 为 false / 历史只有一条）时启用：
 *    左滑快速甩动两次（防误触）→ window.close() 关闭标签页，自动落回来处的标签页。
 *    规范允许脚本关闭「会话历史只有一条」的标签页，压扁正好把深度钉在 1。
 */
(() => {
  'use strict'

  // 仅顶层窗口运行：不进 BiliKit·Float 的抽屉 iframe（抽屉内导航由 Float 自行管理）
  if (window.top !== window.self) return

  // 单例守卫：防止重复安装/注入导致 pushState 被包多层、甩动判定翻倍
  if (window.__BILIKIT_WAY_BACK__) return
  window.__BILIKIT_WAY_BACK__ = true

  /* ------------------------------------------------------------------ *
   * 配置（可按需修改）
   * ------------------------------------------------------------------ */
  const CONFIG = {
    flattenHistory: true, // 跨视频跳转 push→replace，历史深度不增长
    flickClose: true, // 无路可退时甩动关闭标签页
    confirmFlick: true, // 需在确认窗口内甩两次才关，防误触（误关可 ⌘⇧T 找回）
    swipeBackDeltaXSign: -1, // 「返回」对应的 deltaX 方向：-1=向右滑(macOS 自然滚动)；反了改 1
  }

  // 甩动判定参数：死区/速度制与 Float 同源（已实测调教），minTravel 略高于
  // Float 的 4% 兜底——这里没有跟手视觉反馈，门槛更高一点防误触
  const SWIPE = {
    deadZone: 32, // px：累计横向位移小于此值完全忽略（微小滑动不算）
    flickVelocity: 2.4, // px/ms：速度峰值达到此值才算「甩」，与刷新率无关
    minTravel: 80, // px：本次手势总位移下限，防止单帧抖动被算成甩动
    idleMs: 150, // ms：超过此时长无 wheel 视为松手，结算本次手势
    confirmWindowMs: 1600, // ms：两次甩动的确认窗口
  }

  // 命中即处理的视频页路径：普通视频 / 番剧播放页
  const VIDEO_PATH_RE = /\/(video\/(BV\w+|av\d+)|bangumi\/play\/)/i

  // 提取「同一个视频」的标识：BV/av 号或番剧 ep/ss 号；取不到返回空串
  function videoIdOf(href) {
    try {
      const p = new URL(href, location.href).pathname
      return p.match(/\/video\/(BV\w+|av\d+)/i)?.[1]?.toLowerCase()
        || p.match(/\/bangumi\/play\/((ep|ss)\d+)/i)?.[1]?.toLowerCase()
        || ''
    } catch (_) {
      return ''
    }
  }

  function sameVideo(a, b) {
    const ia = videoIdOf(a)
    return !!ia && ia === videoIdOf(b)
  }

  /* ------------------------------------------------------------------ *
   * 一、历史压扁
   * ------------------------------------------------------------------ */
  if (CONFIG.flattenHistory) {
    // SPA 跳转（自动连播、播放器「下一个」、推荐位）：包一层 pushState，
    // 「视频页 → 另一个视频页」改写为 replaceState（state 原样透传，路由读到的内容不变）
    const origPush = history.pushState
    history.pushState = function (state, title, url) {
      try {
        if (url != null) {
          const target = new URL(url, location.href)
          if (
            VIDEO_PATH_RE.test(target.pathname) &&
            VIDEO_PATH_RE.test(location.pathname) &&
            !sameVideo(target.href, location.href) // 同视频(分P/参数变化)保留 push
          ) {
            return history.replaceState.call(this, state, title, url)
          }
        }
      } catch (_) {
        // URL 解析失败等异常 → 走原始 push，绝不拦路
      }
      return origPush.call(this, state, title, url)
    }

    // 链接点击的整页导航：浏览器自身压栈，pushState 包不住，捕获阶段改写为 location.replace
    document.addEventListener(
      'click',
      (e) => {
        // 仅纯左键单击；修饰键/中键 → 浏览器默认（新标签等），不干预
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
        const a = (e.target instanceof Element ? e.target : null)?.closest('a[href]')
        if (!a) return
        if (a.target && a.target !== '_self') return // target=_blank 等交给浏览器
        let url
        try {
          url = new URL(a.href, location.href)
        } catch (_) {
          return
        }
        if (url.origin !== location.origin || !VIDEO_PATH_RE.test(url.pathname)) return
        if (sameVideo(url.href, location.href)) return // 同视频内跳转不干预
        e.preventDefault()
        e.stopPropagation()
        location.replace(url.href) // 整页加载但不压历史
      },
      true,
    )
  }

  /* ------------------------------------------------------------------ *
   * 二、甩动关闭标签页
   * ------------------------------------------------------------------ */
  // 「无路可退」才接管甩动：还有历史可退时让位给浏览器原生返回手势，
  // 避免在「列表页同标签点进来」的场景把整个标签页（连同列表）误关掉。
  function nothingToGoBack() {
    if (window.navigation && typeof window.navigation.canGoBack === 'boolean') {
      return !window.navigation.canGoBack
    }
    return history.length <= 1 // 旧 Safari 回退：只有一条历史必然无路可退
  }

  let accX = 0 // 本次手势累计「返回方向」位移
  let peakV = 0 // 本次手势速度峰值(px/ms)
  let lastTs = 0 // 上一个有效 wheel 时间戳
  let idleTimer = null // 松手结算定时器
  let armedAt = 0 // 第一次甩动的时刻（确认窗口起点）

  function onWheel(e) {
    if (!CONFIG.flickClose) return
    if (document.fullscreenElement) return // 全屏播放中不响应，防误关
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 2) return // 排除竖向滚动
    if (!nothingToGoBack()) return

    const step = e.deltaX * CONFIG.swipeBackDeltaXSign
    // 间隔夹紧 [4,32]ms 再算速度：>32ms 视为新手势起步，<4ms 防爆发除出离谱值（与 Float 同）
    const dt = Math.min(32, Math.max(4, e.timeStamp - lastTs))
    lastTs = e.timeStamp
    accX = Math.max(0, accX + step)
    if (accX > SWIPE.deadZone) {
      const v = step / dt
      if (v > peakV) peakV = v
    }
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = window.setTimeout(judge, SWIPE.idleMs)
  }

  // 松手结算：速度够 + 位移够 = 一次有效甩动
  function judge() {
    idleTimer = null
    const flick = peakV >= SWIPE.flickVelocity && accX >= SWIPE.minTravel
    accX = 0
    peakV = 0
    if (!flick) return

    if (!CONFIG.confirmFlick || Date.now() - armedAt <= SWIPE.confirmWindowMs) {
      armedAt = 0
      window.close()
      // close 成功则后面不会执行；被拒绝（如非脚本打开且实现收紧）时给降级提示
      window.setTimeout(() => toast('无法自动关闭，请按 ⌘W'), 80)
      return
    }
    armedAt = Date.now()
    toast('↩ 再甩一次关闭标签页')
  }

  /* ------------------------------------------------------------------ *
   * 轻提示
   * ------------------------------------------------------------------ */
  let toastEl = null
  let toastTimer = null
  function toast(text) {
    if (!document.body) return
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:48px', 'transform:translateX(-50%)',
        'z-index:2147483600', 'background:rgba(18,18,22,.92)', 'color:#fff',
        'font:13px/1 -apple-system,sans-serif', 'padding:10px 16px',
        'border-radius:20px', 'opacity:0', 'transition:opacity .2s ease',
        'pointer-events:none',
      ].join(';')
      document.body.appendChild(toastEl)
    }
    toastEl.textContent = text
    toastEl.style.opacity = '1'
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toastEl.style.opacity = '0'
    }, SWIPE.confirmWindowMs)
  }

  window.addEventListener('wheel', onWheel, { passive: true, capture: true })
})()
