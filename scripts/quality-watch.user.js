// ==UserScript==
// @name         BiliKit · 清晰度自适应
// @name:en      BiliKit · Adaptive Quality
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.1.0
// @description    替代 B 站那个一上来就顶 4K 然后卡死的「自动」：从稳妥档起步，网速充裕才逐档上爬，卡顿立刻降档，永不卡死在扛不住的清晰度。
// @description:en Replace Bilibili's "Auto" (which jumps to 4K and stalls): start at a safe level, climb up only when bandwidth is ample, drop instantly on stalls — never stuck buffering at a tier your network can't sustain.
// @author       shiinayane
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * 为什么要它：B 站网页端的「自动」不是 YouTube 那种逐分片无缝 ABR，更像
 * 「起播探一下带宽、在账号允许的上限内挑一档、之后降档非常不积极」。大会员
 * 上限是 4K，起播探测又偏乐观（首个分片从 CDN 边缘秒下、瞬时速率虚高），于是
 * 一上来就顶 4K；真实持续带宽撑不住，缓冲耗尽就一直转圈等下载，而不肯退一步。
 *
 * 本脚本的做法（闭环爬山，只靠 <video> 信号，不重写播放器）：
 * - 接管「自动」：从稳妥档（startQn，默认 1080P）起步，绝不一上来就 4K；
 * - 卡顿降档：缓冲见底 / waiting 频发 → 立刻降一档，并把刚扛不住的那档锁一段
 *   时间不回爬；
 * - 平稳升档：缓冲持续充裕够久 → 试探升一档，没超天花板、没在冷却就上；
 * - 换档不是无缝的（B 站换清晰度会拆掉重建媒体源，约 1 秒重缓冲），所以切档
 *   后有宽限期，不把换流自身的重缓冲误判成卡顿。
 *
 * 与播放器解耦：换档走「点对应档位的菜单项」，按 data-value(qn) 定位而非赌
 * class 名；命令后会确认是否真的切过去，切不动（大会员锁、或选择器不对）就把
 * 那档标记不可用并回退——最坏只是「不起作用」，不会帮倒忙。
 */
(() => {
  'use strict'

  // 单例守卫：重复注入会变成多个看门狗互相打架切档
  if (window.__BILIKIT_QUALITY_WATCH__) return
  window.__BILIKIT_QUALITY_WATCH__ = true

  /* ------------------------------------------------------------------ *
   * 配置
   * ------------------------------------------------------------------ */
  const CONFIG = {
    floorQn: 64, // 不低于此档（64=720P）：再卡也不会糊成马赛克
    ceilQn: 120, // 不高于此档（120=4K）；想彻底禁 4K 改成 116(1080P60)
    startQn: 80, // 接管时的起步档（80=1080P）：之后顺网速往上爬
    showToast: true, // 切档时左下角轻提示
  }

  // 调参：装好后先设 true 跑一次，控制台会自报探测到的档位/当前档/播放器结构，
  // 确认换档选择器命中后再设回 false
  const DEBUG = false
  const log = (...a) => { if (DEBUG) console.log('[QualityWatch]', ...a) }

  // 清晰度档位码（qn）→ 名称。B 站菜单项的 data-value 即此码。
  const QN_LABEL = {
    6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P60',
    80: '1080P', 100: '智能修复', 112: '1080P 高码率', 116: '1080P60',
    120: '4K', 125: 'HDR', 126: '杜比视界', 127: '8K',
  }

  /* ------------------------------------------------------------------ *
   * 时间/阈值常量（毫秒 / 秒）
   * ------------------------------------------------------------------ */
  const POLL_MS = 2000 // 评估周期
  const SWITCH_GRACE_MS = 6000 // 切档后这段时间内的卡顿不计（换流必然重缓冲）
  const STALL_WINDOW_MS = 25000 // 卡顿计数的滑动窗口
  const STALL_TRIGGER = 2 // 窗口内卡顿达到此次数 → 降档
  const LONG_STALL_MS = 3500 // 单次卡顿持续超过此值 → 立即降档
  const SMOOTH_CLIMB_MS = 90000 // 平稳且缓冲充裕持续这么久 → 升一档
  const BACKOFF_MS = 300000 // 刚因卡顿降下来的那一档，锁定这么久不回爬
  const CONFIRM_MS = 8000 // 命令切档后这么久仍没切到 → 判定该档不可用
  const BUFFER_LOW = 2 // 播放中缓冲领先低于此秒数 = 危险
  const BUFFER_HIGH = 12 // 缓冲领先高于此秒数 = 健康，可考虑升档

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  let video = null
  let targetQn = 0 // 我们命令的目标档；0 = 尚未接管
  let pendingQn = 0 // 已命令但还没确认生效的档
  let pendingSince = 0
  let lastSwitchAt = 0
  let smoothSince = 0 // 连续平稳的起点
  let waitingSince = 0 // 本次卡顿（waiting）的起点；0=没在卡
  let stalls = [] // 最近卡顿时间戳
  const lockedUntil = {} // qn → 时间戳：刚扛不住的档，回爬冷却到期前不碰
  const unavailable = new Set() // 确认切不过去的档（账号锁 / 选择器不对）

  const now = () => Date.now()

  /* ------------------------------------------------------------------ *
   * 播放器探测：只认主播放器里的 <video>，换 P/重建后重绑
   * ------------------------------------------------------------------ */
  function playerScope() {
    return document.querySelector('.bpx-player-container') || document
  }

  function findVideo() {
    const v = document.querySelector('.bpx-player-container video') || document.querySelector('video')
    return v && v.tagName === 'VIDEO' ? v : null
  }

  const onWaiting = () => {
    if (video && video.seeking) return
    if (now() - lastSwitchAt < SWITCH_GRACE_MS) return // 换流自身的重缓冲不算
    waitingSince = waitingSince || now()
    stalls.push(now())
  }
  const onResume = () => { waitingSince = 0 }

  function bindVideo(v) {
    if (video === v) return
    if (video) {
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onWaiting)
      video.removeEventListener('playing', onResume)
      video.removeEventListener('canplay', onResume)
    }
    video = v
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('stalled', onWaiting)
    v.addEventListener('playing', onResume)
    v.addEventListener('canplay', onResume)
    // 新流：重置瞬态卡顿状态、给一段宽限；targetQn 跨 P 保留（同一网络环境）
    stalls = []
    waitingSince = 0
    smoothSince = now()
    pendingQn = 0
    lastSwitchAt = now()
    log('bind video', v)
  }

  // 缓冲领先：当前播放点到所在缓冲区段末尾还有多少秒
  function bufferedAhead() {
    if (!video) return 0
    const t = video.currentTime
    const b = video.buffered
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.5 && t <= b.end(i) + 0.5) return Math.max(0, b.end(i) - t)
    }
    return 0
  }

  /* ------------------------------------------------------------------ *
   * 清晰度读写：按 data-value(qn) 定位菜单项，不赌 class 名
   * ------------------------------------------------------------------ */
  function qnItems() {
    return [...playerScope().querySelectorAll('[data-value]')]
      .map((el) => ({ el, qn: parseInt(el.getAttribute('data-value'), 10) }))
      .filter((x) => x.qn in QN_LABEL) // 只留像清晰度的 data-value，挡掉无关元素
  }

  // 当前生效的档：优先读 B 站自己的播放器配置（最稳），回退到菜单激活项
  function currentQn() {
    try {
      const p = JSON.parse(localStorage.getItem('bpx_player_profile') || '{}')
      const q = p?.media?.quality ?? p?.quality
      if (Number.isFinite(q) && q in QN_LABEL) return q
    } catch (_) {}
    const active = qnItems().find(
      (x) => x.el.classList.contains('bpx-state-active') || x.el.getAttribute('data-selected') != null,
    )
    return active ? active.qn : 0
  }

  // 当前账号实际可选、且落在 [floor,ceil] 且未被标记不可用的档，升序
  function rangeQns() {
    const set = qnItems().map((x) => x.qn)
    return [...new Set(set)]
      .filter((q) => q >= CONFIG.floorQn && q <= CONFIG.ceilQn && !unavailable.has(q))
      .sort((a, b) => a - b)
  }

  function clampToRange(q, range) {
    if (!range.length) return 0
    const le = range.filter((x) => x <= q)
    return le.length ? le[le.length - 1] : range[0] // 取不超过 q 的最大档，否则取最低可用
  }
  const nextUp = (q, range) => range.find((x) => x > q)
  const nextDown = (q, range) => [...range].reverse().find((x) => x < q)

  function switchTo(qn, reason) {
    const item = qnItems().find((x) => x.qn === qn)
    if (!item) { log('找不到档位项', qn); return }
    if (currentQn() === qn) { targetQn = qn; return }
    // 菜单项有时需先「激活」其控件容器才响应点击，先尝试唤起再点
    const ctrl = item.el.closest('[class*="quality"]')
    if (ctrl) ctrl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    item.el.click()
    targetQn = qn
    pendingQn = qn
    pendingSince = now()
    lastSwitchAt = now()
    log('切换 →', QN_LABEL[qn], `（${reason}）`)
    if (CONFIG.showToast) toast(`清晰度 → ${QN_LABEL[qn]}`, reason)
  }

  /* ------------------------------------------------------------------ *
   * 决策大脑：每 POLL_MS 跑一次
   * ------------------------------------------------------------------ */
  function evaluate() {
    const v = findVideo()
    if (v) bindVideo(v)
    if (!video || video.paused || video.seeking) return

    const range = rangeQns()
    if (!range.length) return // 菜单还没就绪 / 结构未识别

    const t = now()
    const cur = currentQn()

    // —— 接管「自动」：首次或目标丢失时，设到起步档 ——
    if (!targetQn) {
      const start = clampToRange(CONFIG.startQn, range)
      if (cur === 0 || cur > CONFIG.ceilQn || cur !== start) switchTo(start, '接管自动')
      else targetQn = start
      smoothSince = t
      return
    }

    // —— 确认上一次切档是否真的生效 ——
    if (pendingQn) {
      if (cur === pendingQn) {
        pendingQn = 0
      } else if (t - pendingSince > CONFIRM_MS) {
        unavailable.add(pendingQn) // 切不过去：账号锁或选择器不对 → 弃用此档
        log('该档不可用，弃用', pendingQn)
        pendingQn = 0
        const fb = nextDown(targetQn, rangeQns()) || clampToRange(CONFIG.startQn, rangeQns())
        if (fb && fb !== targetQn) switchTo(fb, '该档不可用，回退')
        else targetQn = fb || targetQn
        return
      } else {
        return // 等待确认期间不做新决策
      }
    }

    // —— 切档宽限期：换流必然重缓冲，不评估卡顿 ——
    if (t - lastSwitchAt < SWITCH_GRACE_MS) { smoothSince = t; return }

    // —— 卡顿 → 降档 ——
    stalls = stalls.filter((ts) => t - ts < STALL_WINDOW_MS)
    const longStalling = waitingSince && t - waitingSince > LONG_STALL_MS
    const ahead = bufferedAhead()
    if (stalls.length >= STALL_TRIGGER || longStalling) {
      const lower = nextDown(targetQn, range)
      if (lower) {
        lockedUntil[targetQn] = t + BACKOFF_MS // 这档刚扛不住，冷却期内不回爬
        stalls = []
        switchTo(lower, '卡顿降档')
      }
      smoothSince = t
      return
    }

    // —— 平稳且缓冲充裕够久 → 升一档 ——
    if (ahead >= BUFFER_HIGH) {
      if (!smoothSince) smoothSince = t
      if (t - smoothSince >= SMOOTH_CLIMB_MS) {
        const upper = nextUp(targetQn, range)
        if (upper && (lockedUntil[upper] || 0) < t) switchTo(upper, '网速充裕升档')
        smoothSince = t // 不论升没升都重置计时，避免连环跳档
      }
    } else {
      smoothSince = t // 缓冲不够充裕，升档计时重来
    }
  }

  /* ------------------------------------------------------------------ *
   * 轻提示
   * ------------------------------------------------------------------ */
  let toastEl = null
  let toastTimer = null
  function toast(text, sub) {
    if (!document.body) return
    if (!toastEl) {
      const style = document.createElement('style')
      style.textContent = `
        .bqw-toast {
          position: fixed; left: 16px; bottom: 24px; z-index: 2147483500;
          display: flex; flex-direction: column; gap: 2px;
          background: rgba(18,18,22,.92); color: #fff;
          font: 13px/1.4 -apple-system, "PingFang SC", sans-serif;
          padding: 9px 14px; border-radius: 12px;
          box-shadow: 0 4px 18px rgba(0,0,0,.34);
          opacity: 0; transform: translateY(6px);
          transition: opacity .2s ease, transform .2s ease; pointer-events: none;
        }
        .bqw-toast.bqw-show { opacity: 1; transform: none; }
        .bqw-toast b { font-weight: 600; color: #fb7299; font-variant-numeric: tabular-nums; }
        .bqw-toast span { font-size: 11px; color: rgba(255,255,255,.55); }
        @media (prefers-color-scheme: light) {
          .bqw-toast { background: rgba(255,255,255,.95); color: #18191c; box-shadow: 0 4px 18px rgba(0,0,0,.16); }
          .bqw-toast b { color: #d6336c; }
          .bqw-toast span { color: rgba(0,0,0,.5); }
        }
      `
      toastEl = document.createElement('div')
      toastEl.className = 'bqw-toast'
      document.body.append(style, toastEl)
    }
    toastEl.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`
    // 强制 reflow 再加显示类，保证每次都过渡
    void toastEl.offsetHeight
    toastEl.classList.add('bqw-show')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.remove('bqw-show'), 2200)
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  setInterval(evaluate, POLL_MS)
  log('started', CONFIG)
})()
