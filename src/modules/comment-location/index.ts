import type { BiliKitModule, Cfg } from '../../core/module'

/**
 * 评论属地：在评论/回复的发布时间旁显示 IP 属地。
 * 迁移自 scripts/comment-location.user.js（逻辑逐字保留）。
 * 不设顶层守卫——需在 Float 抽屉 iframe 内也生效。
 */
function init(cfg: Cfg): void {
  if ((window as any).__BILIKIT_COMMENT_LOC__) return
  ;(window as any).__BILIKIT_COMMENT_LOC__ = true

  const DEBUG = false // 排查时改 true
  const PIN = cfg.get<string>('pin') || '' // 地名前缀符，默认无（想加自己填）

  const log = (...a: unknown[]) => { if (DEBUG) console.log('[评论属地]', ...a) }

  // 取属地：从 action-buttons 起，沿 shadow host 链向上找 reply_control.location
  function resolveLocation(el: any): string | null {
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

  const format = (loc: string) => loc.replace(/^\s*IP属地[:：]\s*/, '') // 恒去「IP属地：」前缀，只留地名

  // 穿透嵌套 shadow：给每个 action-buttons 注入属地；给每个尚未观察的嵌套 shadowRoot 挂作用域 observer。
  const observed = new WeakSet<ShadowRoot>()
  function observeRoot(sr: ShadowRoot): void {
    if (observed.has(sr)) return
    observed.add(sr)
    new MutationObserver((muts) => {
      // 只在「编辑器之外新增了元素节点」时才排扫（新评论/回复批次都是元素节点）。
      // 逐条按 target 判 contenteditable 在混合批次里会被绕过，导致输入框打字引发的 childList
      // 抖动仍触发全树 walk；改为看 addedNodes：编辑器内新增节点 isContentEditable 继承为 true，跳过。
      for (const m of muts) {
        if (m.type !== 'childList') continue
        for (const n of m.addedNodes as any) {
          if (n.nodeType === 1 && !n.isContentEditable) { schedule(); return }
        }
      }
    }).observe(sr, { childList: true, subtree: true })
  }
  // 从某根穿透整树：注入属地 + 给每个嵌套 shadowRoot 挂观察者。root 可为 Element 或 ShadowRoot
  function walk(root: any): void {
    if (root.localName === 'bili-comment-action-buttons-renderer') inject(root)
    let nodes
    try { nodes = root.querySelectorAll('*') } catch (_) { return }
    for (const n of nodes) {
      if (n.localName === 'bili-comment-action-buttons-renderer') inject(n)
      const sr = n.shadowRoot
      if (sr) { observeRoot(sr); walk(sr) }
    }
  }

  // 块间距：量一次「点赞」块左外边距当原生间距、缓存复用。
  let nativeGap = ''
  function blockGap(sr: any): string {
    if (!nativeGap) {
      const sib = sr.querySelector('#like') || sr.querySelector('#reply') || sr.querySelector('#dislike')
      const m = sib ? getComputedStyle(sib).marginLeft : ''
      if (m && m !== '0px') nativeGap = m
    }
    return nativeGap || '16px' // 首条尚未量到时的兜底
  }

  // 判重用「shadow 内是否已有 .bilikit-loc」，兼容 lit 重渲染后补回。
  function inject(ab: any): boolean {
    const sr = ab.shadowRoot
    if (!sr || sr.querySelector('.bilikit-loc')) return false
    const pubdate = sr.querySelector('#pubdate')
    if (!pubdate) return false
    const loc = resolveLocation(ab)
    if (!loc) { if (DEBUG) log('未取到属地，ab.data=', ab.data); return false }
    const span = document.createElement('span')
    span.className = 'bilikit-loc'
    span.textContent = PIN + format(loc)
    // 属地紧跟时间：左外边距取原生块间距的一半（/2 半距 → /3 更近、/1.5 更远）。color 借 --text3 贴合主题。
    span.style.cssText = `margin-left:calc(${blockGap(sr)} / 2);color:var(--text3,#9499a0);font-size:inherit;white-space:nowrap;`
    pubdate.after(span)
    return true
  }

  // 排一帧后从顶层整树扫一遍（rAF 合并突发变更；整树扫、已处理跳过）。
  let topRoot: any = null
  let rafId = 0
  function schedule(): void {
    if (rafId || !topRoot) return
    rafId = requestAnimationFrame(() => { rafId = 0; walk(topRoot) })
  }

  function bind(comments: any): void {
    const sr = comments.shadowRoot
    if (!sr) return
    topRoot = sr
    observeRoot(sr) // 顶层：懒加载新批次；更深展开由 walk 逐层挂的观察者捕获
    walk(sr) // 首扫
    log('已绑定 bili-comments')
  }

  // 引导：等 #commentapp 里的 bili-comments 出现；SPA 换视频后换宿主则重绑。
  let current: any = null
  function tryBind(): void {
    const c = document.querySelector('#commentapp bili-comments')
    if (c && c !== current && (c as any).shadowRoot) { current = c; bind(c) }
  }

  function watch(app: Element): void {
    new MutationObserver(tryBind).observe(app, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-params'],
    })
    tryBind()
  }

  const app = document.querySelector('#commentapp')
  if (app) {
    watch(app)
  } else {
    // #commentapp 尚未挂载：轻量轮询直到出现，找到即停
    let tries = 0
    const t = setInterval(() => {
      const a = document.querySelector('#commentapp')
      if (a) { clearInterval(t); watch(a) }
      else if (++tries > 40) clearInterval(t) // ~20s 兜底放弃
    }, 500)
  }

  log('已启动')
}

export const commentLocation: BiliKitModule = {
  id: 'comment-location',
  name: '评论属地',
  description: '评论/回复时间旁显示 IP 属地',
  category: '界面',
  runAt: 'idle',
  settings: [
    { key: 'pin', type: 'text', label: '地名前缀符', default: '', placeholder: '如 📍 ', hint: '显示在属地前，默认无；想加自己填' },
  ],
  init,
}
