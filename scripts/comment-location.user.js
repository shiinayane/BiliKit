// ==UserScript==
// @name         BiliKit · 评论属地
// @name:en      BiliKit · Comment Location
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.1.2
// @description    在评论/回复的发布时间旁显示 IP 属地。轻量、Safari 友好，替代会把视频页拖卡的第三方「开盒」类脚本（实现见脚本头注释）。
// @description:en Show each comment's IP location next to its timestamp. Lightweight and Safari-friendly — a performant replacement for heavy third-party scripts.
// @author       shiinayane
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @match        *://www.bilibili.com/list/*
// @match        *://www.bilibili.com/cheese/play/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/582118/BiliKit%20%C2%B7%20%E8%AF%84%E8%AE%BA%E5%B1%9E%E5%9C%B0.user.js
// @updateURL https://update.greasyfork.org/scripts/582118/BiliKit%20%C2%B7%20%E8%AF%84%E8%AE%BA%E5%B1%9E%E5%9C%B0.meta.js
// ==/UserScript==

/*
 * 为什么不抄「开盒」那套：它的性能罪状（实测能把视频页内存推到 4GB、被 Safari 判休眠）——
 *   1. 全局 patch Body/Head 的 appendChild/insertBefore；
 *   2. observer.observe(body, {subtree:true}) + 回调不去抖，每次触发都 document.querySelectorAll 全文档；
 *   3. node.outerHTML = node.outerHTML + span（重解析整段 + 留下 Vue 孤儿）；
 *   4. fetch + eval 整个评论 bundle 去打补丁。
 * 主线程被打满后 WebKit 没空闲做 GC/退图，内存间接滚雪球。
 *
 * 本脚本反着来：
 *   · 观察者只挂在评论子树的各层 shadowRoot 上(MutationObserver 不跨 shadow 边界，故逐层挂)，不碰 body；
 *   · 任意一层有变更就排一帧(rAF)后整树扫一遍——评论树仅几十~几百节点、已处理的跳过，足够快又不漏；
 *   · 子回复展开渲染进某条评论自己的嵌套 shadow，那层观察者即时触发 → 一帧内出，无需定时猜；
 *   · 属地直接从 lit 组件实例属性取（沿 shadow host 链向上找 reply_control.location），不发请求、不 eval；
 *   · 注入是 createElement + pubdate.after(span)，并以「shadow 内是否已有 .bilikit-loc」判重(也兼容 lit 重渲染后补回)。
 *
 * Safari 关键：必须 @grant none 跑页面世界，才能读到 DOM 元素上挂的 lit 实例属性(.data)；
 * 一旦带 @grant，Userscripts 会把脚本注入隔离世界，只看得到 DOM、读不到这些 JS 属性，属地就取不到。
 */
(() => {
  'use strict'

  // 单例守卫按 window 计；不设顶层守卫——float 抽屉用同源 iframe 载视频页，里头也有评论，
  // 让它在子框架照常生效。脚本极轻(每帧合并+作用域观察)，多框架各一份无妨。
  if (window.__BILIKIT_COMMENT_LOC__) return
  window.__BILIKIT_COMMENT_LOC__ = true

  /* ------------------------------------------------------------------ *
   * 配置
   * ------------------------------------------------------------------ */
  const DEBUG = false            // 排查时改 true：会打印绑定/注入日志，并在取不到属地时提示
  const STRIP_PREFIX = true      // 去掉「IP属地：」前缀，只留地名
  const PIN = ''                 // 地名前缀符，默认无；想加图标如设 '📍 '

  const log = (...a) => { if (DEBUG) console.log('[评论属地]', ...a) }

  /* ------------------------------------------------------------------ *
   * 取属地：从 action-buttons 起，沿 shadow host 链向上找 reply_control.location
   * 不写死「数据挂在哪个组件」——lit 把声明的响应式属性放在实例上(.data/.reply 等)，
   * 沿宿主链向上探几跳，命中即返回，组件结构小改也不至于失灵。
   * ------------------------------------------------------------------ */
  function resolveLocation(el) {
    let n = el, hop = 0
    while (n && hop++ < 8) {
      for (const key of ['data', 'reply', '_data']) {
        const d = n[key]
        const loc = d && d.reply_control && d.reply_control.location
        if (typeof loc === 'string' && loc) return loc
      }
      const root = n.getRootNode ? n.getRootNode() : null
      n = root instanceof ShadowRoot ? root.host : n.parentElement // 跨 shadow 边界向上
    }
    return null
  }

  const format = (loc) => (STRIP_PREFIX ? loc.replace(/^\s*IP属地[:：]\s*/, '') : loc)

  /* ------------------------------------------------------------------ *
   * 穿透嵌套 shadow：① 给每个 action-buttons 注入属地；② 给每个尚未观察的嵌套
   * shadowRoot 挂一个作用域 observer。
   * 为什么要逐层挂：MutationObserver 不跨 shadow 边界——「展开更多回复」是把回复
   * 异步渲染进某条评论自己的嵌套 shadow，顶层 observer 看不到。给每个 shadow 各挂
   * 一个小观察者，回复一渲染进来就即时触发，无需定时猜渲染完没完。
   * 触发后排一帧(rAF)整树扫一遍：评论树仅几十~几百节点、已处理的跳过，足够快又不漏。
   * ------------------------------------------------------------------ */
  const observed = new WeakSet()
  function observeRoot(sr) {
    if (observed.has(sr)) return
    observed.add(sr)
    new MutationObserver((muts) => {
      // 跳过「在评论/回复输入框里打字」：编辑器(contenteditable)也在评论 shadow 内，
      // 不滤的话每次按键的 DOM 变更都会触发一次整树扫。只要有一条变更不在可编辑区就照常排扫。
      for (const m of muts) {
        const t = m.target
        if (t && t.nodeType === 1 && t.isContentEditable) continue
        schedule(); return
      }
    }).observe(sr, { childList: true, subtree: true })
  }
  // 从某根穿透整树：注入属地 + 给每个嵌套 shadowRoot 挂观察者(已挂的跳过)。root 可为 Element 或 ShadowRoot
  function walk(root) {
    if (root.localName === 'bili-comment-action-buttons-renderer') inject(root)
    let nodes
    try { nodes = root.querySelectorAll('*') } catch (_) { return }
    for (const n of nodes) {
      if (n.localName === 'bili-comment-action-buttons-renderer') inject(n)
      const sr = n.shadowRoot
      if (sr) { observeRoot(sr); walk(sr) }
    }
  }

  // 块间距：行内是 flex、column-gap 为 normal(无)，各块间距全靠原生块自身的左外边距撑。
  // 量一次「点赞」块的左外边距当原生间距、缓存复用(所有评论同一套样式、值一致，免每条重复读)。
  let nativeGap = ''
  function blockGap(sr) {
    if (!nativeGap) {
      const sib = sr.querySelector('#like') || sr.querySelector('#reply') || sr.querySelector('#dislike')
      const m = sib ? getComputedStyle(sib).marginLeft : ''
      if (m && m !== '0px') nativeGap = m
    }
    return nativeGap || '16px' // 首条尚未量到时的兜底
  }

  // 给一个 action-buttons 注入属地标签。判重用「shadow 内是否已有 .bilikit-loc」，
  // 不用 JS 标记——这样 lit 若在重渲染时清掉了我们的 span，下次扫描会自然补回。
  function inject(ab) {
    const sr = ab.shadowRoot
    if (!sr || sr.querySelector('.bilikit-loc')) return false
    const pubdate = sr.querySelector('#pubdate')
    if (!pubdate) return false
    const loc = resolveLocation(ab)
    if (!loc) { if (DEBUG) log('未取到属地，ab.data=', ab.data); return false }
    const span = document.createElement('span')
    span.className = 'bilikit-loc'
    span.textContent = PIN + format(loc)
    // 左外边距对齐原生块间距：时间块没有右边距，若只给个小 margin，「时间→属地」会比其余块都窄；
    // color 借组件自己的 --text3 变量贴合主题
    span.style.cssText = `margin-left:${blockGap(sr)};color:var(--text3,#9499a0);font-size:inherit;white-space:nowrap;`
    pubdate.after(span)
    return true
  }

  // 排一帧后从顶层整树扫一遍。用 rAF(≈16ms)合并一阵突发变更、把延迟压到一帧；
  // 整树扫(而非只扫变更子树)——评论树就几十~几百节点、已处理的跳过，足够快又不漏。
  let topRoot = null
  let rafId = 0
  function schedule() {
    if (rafId || !topRoot) return
    rafId = requestAnimationFrame(() => { rafId = 0; walk(topRoot) })
  }

  /* ------------------------------------------------------------------ *
   * 绑定到某个 bili-comments：观察其各层 shadowRoot；任意一层有变更即排一帧整树补标签
   * ------------------------------------------------------------------ */
  function bind(comments) {
    const sr = comments.shadowRoot
    if (!sr) return
    topRoot = sr
    observeRoot(sr) // 顶层：懒加载新批次把 thread 宿主增删到这里；更深的展开由 walk 逐层挂的观察者捕获
    walk(sr)        // 首扫：注入当前评论 + 沿树给各嵌套 shadow 挂观察者
    log('已绑定 bili-comments')
  }

  /* ------------------------------------------------------------------ *
   * 引导：等 #commentapp 里的 bili-comments 出现；SPA 换视频后换了宿主则重绑
   * 只观察 #commentapp 这个轻量容器(其 light 子树仅含宿主，shadow 不计入)，不碰 body。
   * ------------------------------------------------------------------ */
  let current = null
  function tryBind() {
    const c = document.querySelector('#commentapp bili-comments')
    if (c && c !== current && c.shadowRoot) { current = c; bind(c) }
  }

  function watch(app) {
    new MutationObserver(tryBind).observe(app, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-params'],
    })
    tryBind()
  }

  const app = document.querySelector('#commentapp')
  if (app) {
    watch(app)
  } else {
    // #commentapp 尚未挂载：轻量轮询直到出现(仅 querySelector，成本可忽略)，找到即停
    let tries = 0
    const t = setInterval(() => {
      const a = document.querySelector('#commentapp')
      if (a) { clearInterval(t); watch(a) }
      else if (++tries > 40) clearInterval(t) // ~20s 兜底放弃
    }, 500)
  }

  log('已启动')
})()
