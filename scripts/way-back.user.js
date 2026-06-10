// ==UserScript==
// @name         BiliKit · 回程
// @name:en      BiliKit · Way Back
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.7.0
// @description    视频标签页的来时路：站内跨视频跳转零刷新压扁（历史钉在 1，链接新开的标签左滑即原生关闭），左下角悬浮回退栈点击即跳回并续播。与 BiliKit·浮窗抽屉自动协同。
// @description:en Flatten in-site cross-video SPA history with zero reloads (history pinned at 1, so Safari's native swipe closes link-opened tabs), and keep a floating back-stack you can click to jump back, resuming playback. Auto-coordinates with BiliKit Float.
// @author       shiinayane
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * 解决的场景：标签页里连续跳了很多视频后，「回到之前的某个视频」和「看完离开」
 * 都不该靠一格格按返回。
 *
 * 两件套：
 * 1. 历史压扁（仅 SPA）—— 站内跨视频跳转由 B 站自己的 pushState 完成，包一层
 *    改写成 replaceState：零重载、历史深度钉在 1。由此白赚 Safari 的原生行为：
 *    链接自动新开的标签页（B 站视频链接都是 target=_blank）只要历史保持 1，
 *    两指左滑 = 关闭标签页并回到来源页——「关闭」不归本脚本管，零适配、
 *    零误触面，与 BiliKit·Float 天然共存（⌘点击等手动开的标签 Safari 本就
 *    不给此待遇，视为各自独立，不在处理范围内）。
 *    不拦截链接点击——拦截会把 B 站的 SPA 跳转打断成整页重载（也曾与 Float
 *    的点击接管叠加造成双重加载）。真·整页导航（少数链接、JS 赋值 location）
 *    会压一条历史：左滑变成先回退一格，回退栈照样记录了来时路。
 *    float 抽屉打开期间（html.bfloat-open）跳过改写但照记栈；分 P 切换保留 push。
 * 2. 回退栈 —— 被压扁的「来时路」记在 sessionStorage（按标签页隔离，关页即清）。
 *    左下角悬浮胶囊「↩ N」：点胶囊回退一层；悬停展开列表点任意一项跳回
 *    （location.replace + ?t= 续播）。跳回第 i 层丢弃其上的层。
 */
(() => {
  'use strict'

  // 仅顶层窗口运行：不进 BiliKit·Float 的抽屉 iframe
  if (window.top !== window.self) return

  // 单例守卫：防止重复安装/注入导致 pushState 被包多层、甩动判定翻倍
  if (window.__BILIKIT_WAY_BACK__) return
  window.__BILIKIT_WAY_BACK__ = true

  /* ------------------------------------------------------------------ *
   * 配置（可按需修改）
   * ------------------------------------------------------------------ */
  const CONFIG = {
    showStack: true, // 左下角悬浮回退栈
    resumeTime: true, // 跳回时带上离开时的播放进度(?t=)续播
  }

  const STACK_KEY = 'bilikit-wayback-stack'
  const STACK_MAX = 20 // 栈深上限，超出丢最老的

  // 提取「同一个视频」的标识：BV/av 号或番剧 ep/ss 号；取不到返回空串。
  // 路径形态与 float.user.js 的 VIDEO_LINK_RE 是同一份认知，B 站改 URL 时两边同步改。
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

  /* ------------------------------------------------------------------ *
   * 一、回退栈（纯旁观记录，不干预任何导航）
   * ------------------------------------------------------------------ */
  function readStack() {
    try {
      const arr = JSON.parse(sessionStorage.getItem(STACK_KEY) || '[]')
      return Array.isArray(arr) ? arr : []
    } catch (_) {
      return []
    }
  }

  function writeStack(stack) {
    try {
      sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(-STACK_MAX)))
    } catch (_) {
      // 存储被禁/超限则放弃记录，甩动关闭不受影响
    }
  }

  function cleanTitle(raw) {
    // 剥掉串尾连续的站点后缀段（视频页 _哔哩哔哩_bilibili、番剧页 _番剧_bilibili_哔哩哔哩 等
    // 顺序不一），锚定串尾逐段剥，正文里含「哔哩哔哩」的标题不受伤
    return raw.replace(/(_(哔哩哔哩|bilibili|番剧|动画|电影|电视剧|纪录片|综艺|国创|在线观看|全集))+$/i, '').trim()
  }

  // 把「即将离开的视频」记入栈顶。prevHref/prevTitle/t 都在离开前捕获。
  // rerender=false 给 pagehide 用：页面正在销毁，重建列表 DOM 是纯浪费。
  function recordEntry(prevHref, prevTitle, t, rerender = true) {
    const id = videoIdOf(prevHref)
    if (!id) return
    const stack = readStack()
    if (stack.length && videoIdOf(stack[stack.length - 1].url) === id) return // 连续同视频去重
    stack.push({
      url: prevHref,
      title: cleanTitle(prevTitle) || id,
      t: CONFIG.resumeTime && t > 0 ? Math.floor(t) : 0,
    })
    writeStack(stack)
    if (rerender) renderChip(stack)
  }

  function currentVideoTime() {
    const v = document.querySelector('video')
    return v && Number.isFinite(v.currentTime) ? v.currentTime : 0
  }

  // SPA 跳转压扁：包一层 pushState，「视频页 → 另一个视频页」改写为 replaceState
  // （state 原样透传）。两个例外：
  // - float 抽屉打开期间不改写——栈顶是抽屉的关闭锚点，replace 会把它炸掉
  //   （背景页自动连播 + 抽屉打开的组合）。判断依据是 <html> 的 bfloat-open 类
  //   （抽屉的活状态），而非 history.state.bfloatDrawer：那个标记在「连播把条目
  //   压在锚点上 → 关抽屉 back() 落回锚点」之后会残留在当前条目上，按它判断
  //   会从此永久关停压扁。改写跳过时回退栈照记，来时路不丢。
  // - 番剧 ss→ep 是同一内容的 URL 规范化改写：照样压扁，但不记入回退栈。
  const origPush = history.pushState
  history.pushState = function (...args) {
    try {
      const url = args[2]
      if (url != null) {
        const target = new URL(url, location.href)
        const prevId = videoIdOf(location.href)
        const curId = videoIdOf(target.href)
        if (prevId && curId && prevId !== curId) {
          if (!(prevId.startsWith('ss') && curId.startsWith('ep'))) {
            recordEntry(location.href, document.title, currentVideoTime())
          }
          if (!document.documentElement.classList.contains('bfloat-open')) {
            return history.replaceState.apply(this, args)
          }
        }
      }
    } catch (_) {
      // URL 解析失败等异常 → 走原始 push，绝不拦路
    }
    return origPush.apply(this, args)
  }

  // 兜底：pushState 包不住的整页离开（真·整页链接、JS 赋值 location.href 等）。
  // 不拦截点击——拦了会把 B 站自己的 SPA 跳转打断成整页重载，得不偿失。
  // 这类导航会压一条历史（无法阻止），但来时路被记下，回退栈照样可用；
  // 目的地未知也没关系——若下一页是同一视频（刷新/返回），加载时的去重会弹掉它。
  // jumpTo 自己的 replace 除外：用户是在「回去」，把刚离开的页面记成来时路
  // 会让栈里冒出一条「前进」幽灵。
  let leavingViaJump = false
  window.addEventListener('pagehide', () => {
    if (leavingViaJump) return
    recordEntry(location.href, document.title, currentVideoTime(), false)
  })

  // 跳回第 i 层（i=-1 表示栈顶）：丢弃其上的层（与真实历史的「前进分支销毁」
  // 语义一致），replace 不增历史
  function jumpTo(i) {
    const stack = readStack()
    if (i < 0) i = stack.length - 1
    const entry = stack[i]
    if (!entry) return
    writeStack(stack.slice(0, i))
    leavingViaJump = true
    let href = entry.url
    try {
      const u = new URL(entry.url, location.href)
      if (entry.t > 5) u.searchParams.set('t', String(entry.t)) // 开头几秒不值得续播
      href = u.href
    } catch (_) {}
    location.replace(href)
  }

  // 加载时去重：栈顶若与当前视频相同（刷新、原生返回、分 P 的 pagehide 记录）→ 弹掉
  function dedupeOnArrival() {
    const curId = videoIdOf(location.href)
    if (!curId) return
    const stack = readStack()
    let n = stack.length
    while (n && videoIdOf(stack[n - 1].url) === curId) n--
    if (n !== stack.length) writeStack(stack.slice(0, n))
  }

  /* ------------------------------------------------------------------ *
   * 二、悬浮回退栈 UI（懒创建：栈空的页面零 DOM、零样式表）
   * ------------------------------------------------------------------ */
  let chipRoot = null
  let listEl = null
  let countEl = null

  function ensureChip() {
    if (chipRoot || !document.body) return
    const style = document.createElement('style')
    style.textContent = `
      .bwb-root {
        /* 故意比 float 遮罩(2147483600)低：抽屉打开时胶囊被罩住，点不到也甩不走宿主页 */
        position: fixed; left: 16px; bottom: 24px; z-index: 2147483500;
        font: 13px/1.5 -apple-system, "PingFang SC", sans-serif;
      }
      .bwb-chip {
        display: flex; align-items: center; gap: 6px;
        height: 34px; padding: 0 14px; border-radius: 17px; cursor: pointer;
        border: 1px solid rgba(255,255,255,.08);
        background: rgba(18,18,22,.92); color: #fff;
        font: inherit; font-weight: 500;
        box-shadow: 0 2px 12px rgba(0,0,0,.28);
        opacity: .55; transition: opacity .15s ease, transform .15s ease;
      }
      .bwb-chip svg { display: block; flex: 0 0 auto; }
      .bwb-chip .bwb-count { color: #fb7299; font-variant-numeric: tabular-nums; }
      .bwb-root:hover .bwb-chip { opacity: 1; transform: translateY(-1px); }
      .bwb-chip:active { transform: scale(.96); }
      .bwb-list {
        position: absolute; left: 0; bottom: 100%;
        /* 透明边框充当与胶囊的视觉间隙：鼠标穿过时仍在列表元素内，hover 不断链 */
        border-bottom: 10px solid transparent; background-clip: padding-box;
        display: flex; flex-direction: column; /* 顺序排，最新一条在底部贴近胶囊 */
        min-width: 220px; max-width: 320px; max-height: 50vh; overflow-y: auto;
        background-color: rgba(18,18,22,.94); border-radius: 14px; padding: 6px;
        box-shadow: 0 8px 32px rgba(0,0,0,.42);
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        opacity: 0; visibility: hidden; transform: translateY(6px);
        pointer-events: none;
        /* 离开后延迟 .15s 再开始收起，给指针迁移留宽限 */
        transition: opacity .16s ease .15s, transform .16s ease .15s, visibility 0s linear .31s;
      }
      .bwb-root:hover .bwb-list {
        opacity: 1; visibility: visible; transform: none; pointer-events: auto;
        transition-delay: 0s;
      }
      .bwb-head {
        padding: 4px 10px 6px; font-size: 11px; color: rgba(255,255,255,.45);
        user-select: none;
      }
      .bwb-item {
        display: flex; align-items: center; gap: 8px;
        width: 100%; padding: 8px 10px; border: none; border-radius: 9px;
        cursor: pointer; background: none; color: #ddd; font: inherit;
        text-align: left;
      }
      .bwb-item:hover { background: rgba(255,255,255,.1); color: #fff; }
      .bwb-item-num {
        flex: 0 0 auto; min-width: 18px; text-align: right;
        font-size: 11px; color: rgba(255,255,255,.35);
        font-variant-numeric: tabular-nums; user-select: none;
      }
      .bwb-item:hover .bwb-item-num { color: #fb7299; }
      .bwb-item-title {
        flex: 1 1 auto; min-width: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .bwb-item-time {
        flex: 0 0 auto; font-size: 11px; color: rgba(255,255,255,.4);
        font-variant-numeric: tabular-nums;
      }
      .bwb-item:hover .bwb-item-time { color: rgba(255,255,255,.65); }

      /* 浅色系统主题（theme-sync 让 B 站跟随系统，这里一并跟随） */
      @media (prefers-color-scheme: light) {
        .bwb-chip {
          background: rgba(255,255,255,.92); color: #18191c;
          border-color: rgba(0,0,0,.08);
          box-shadow: 0 2px 12px rgba(0,0,0,.12);
        }
        /* 浅底上 B 站粉(#fb7299)对比不足，换更深的粉保证可读 */
        .bwb-chip .bwb-count { color: #d6336c; }
        .bwb-list {
          background-color: rgba(255,255,255,.95);
          box-shadow: 0 8px 32px rgba(0,0,0,.18);
        }
        .bwb-head { color: rgba(0,0,0,.4); }
        .bwb-item { color: #333; }
        .bwb-item:hover { background: rgba(0,0,0,.06); color: #000; }
        .bwb-item-num { color: rgba(0,0,0,.3); }
        .bwb-item:hover .bwb-item-num { color: #d6336c; }
        .bwb-item-time { color: rgba(0,0,0,.35); }
        .bwb-item:hover .bwb-item-time { color: rgba(0,0,0,.55); }
      }
    `
    chipRoot = document.createElement('div')
    chipRoot.className = 'bwb-root'
    chipRoot.append(style)

    listEl = document.createElement('div')
    listEl.className = 'bwb-list'

    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'bwb-chip'
    chip.title = '点击回退一层；悬停查看来时路'
    // 文本字符「↩」的字形基线随字体漂，与数字对不齐 → 用内联 SVG，flex 居中像素级对齐
    chip.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 14 4 9l5-5"/>
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
      </svg>
      <span class="bwb-count"></span>`
    countEl = chip.querySelector('.bwb-count')
    chip.addEventListener('click', () => jumpTo(-1)) // 回退一层 = 跳回栈顶

    chipRoot.append(listEl, chip)
    chipRoot.style.display = 'none' // 默认隐藏，renderChip 在栈非空时解除
    document.body.appendChild(chipRoot)
  }

  function fmtTime(t) {
    const h = Math.floor(t / 3600)
    const m = Math.floor((t % 3600) / 60)
    const s = String(t % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  }

  function renderChip(knownStack) {
    if (!CONFIG.showStack || !document.body) return
    const stack = knownStack || readStack()
    if (!stack.length) {
      if (chipRoot) chipRoot.style.display = 'none' // 栈空整个隐藏
      return // 懒创建：没记录过就不建 DOM/样式表
    }
    ensureChip()
    chipRoot.style.display = ''
    countEl.textContent = String(stack.length)
    listEl.textContent = ''
    const head = document.createElement('div')
    head.className = 'bwb-head'
    head.textContent = `来时路 · ${stack.length} 层`
    listEl.appendChild(head)
    stack.forEach((entry, i) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'bwb-item'
      // 序号 = 回退层数：贴近胶囊的最新一条是 1，越往上越多
      const num = document.createElement('span')
      num.className = 'bwb-item-num'
      num.textContent = String(stack.length - i)
      item.appendChild(num)
      const title = document.createElement('span')
      title.className = 'bwb-item-title'
      title.textContent = entry.title
      item.title = entry.title
      item.appendChild(title)
      if (entry.t > 5) {
        const time = document.createElement('span')
        time.className = 'bwb-item-time'
        time.textContent = fmtTime(entry.t)
        item.appendChild(time)
      }
      item.addEventListener('click', () => jumpTo(i))
      listEl.appendChild(item)
    })
    listEl.scrollTop = listEl.scrollHeight // 溢出时停在最新一条（底部）
  }

  function onReady() {
    dedupeOnArrival()
    renderChip()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady)
  } else {
    onReady()
  }
  // bfcache 恢复（原生返回手势回到本页）不触发 DOMContentLoaded，但 pagehide
  // 已经把本页记进了栈——重跑去重和渲染，否则胶囊把「自己」当成来时路展示
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return
    leavingViaJump = false
    onReady()
  })
})()
