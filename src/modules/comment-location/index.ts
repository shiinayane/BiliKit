import type { BiliKitModule, Cfg } from '../../core/module'
import { commentSexIconUrl, normalizeCommentSex } from './core'

/**
 * 评论信息：在姓名旁显示性别、在发布时间旁显示 IP 属地。
 * 性别与属地共用一次 Shadow DOM 遍历/同一组观察器，不为每条评论发请求或新增 observer。
 * 不设顶层守卫——需在 Float 抽屉 iframe 内也生效。
 */
function init(cfg: Cfg): void {
  if ((window as any).__BILIKIT_COMMENT_LOC__) return
  ;(window as any).__BILIKIT_COMMENT_LOC__ = true

  const DEBUG = false // 排查时改 true
  const PIN = cfg.get<string>('pin') || '' // 地名前缀符，默认无（想加自己填）
  const SHOW_SEX = cfg.get<boolean>('showSex') !== false

  const log = (...a: unknown[]) => { if (DEBUG) console.log('[评论信息]', ...a) }

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

  // 穿透嵌套 shadow：给 user-info 注入性别、给 action-buttons 注入属地；二者共用作用域 observer。
  // 记住给评论树各层 shadowRoot 挂的观察器，SPA 换视频重绑时全部断开——否则旧观察器的回调引用模块闭包、
  // 一直可达，会把已脱离 DOM 的整棵旧评论树吊住不放（每看一个带评论的视频积一棵）。这是本模块的内存泄漏点。
  let observers: MutationObserver[] = []
  const observed = new WeakSet<ShadowRoot>()
  function observeRoot(sr: ShadowRoot): void {
    if (observed.has(sr)) return
    observed.add(sr)
    const mo = new MutationObserver((muts) => {
      // 只在「编辑器之外新增了元素节点」时才排扫（新评论/回复批次都是元素节点）。
      // 逐条按 target 判 contenteditable 在混合批次里会被绕过，导致输入框打字引发的 childList
      // 抖动仍触发全树 walk；改为看 addedNodes：编辑器内新增节点 isContentEditable 继承为 true，跳过。
      for (const m of muts) {
        if (m.type !== 'childList') continue
        for (const n of m.addedNodes as any) {
          if (n.nodeType === 1 && !n.isContentEditable) { schedule(); return }
        }
      }
    })
    mo.observe(sr, { childList: true, subtree: true })
    observers.push(mo)
  }
  function process(el: any): void {
    if (el.localName === 'bili-comment-user-info') injectSex(el)
    else if (el.localName === 'bili-comment-action-buttons-renderer') injectLocation(el)
  }

  // 从某根穿透整树：注入评论信息 + 给每个嵌套 shadowRoot 挂观察者。root 可为 Element 或 ShadowRoot
  function walk(root: any): void {
    process(root)
    let nodes
    try { nodes = root.querySelectorAll('*') } catch (_) { return }
    for (const n of nodes) {
      process(n)
      const sr = n.shadowRoot
      if (sr) { observeRoot(sr); walk(sr) }
    }
  }

  // 与 BewlyCat 相同，直接读 bili-comment-user-info.data.member.sex；不查用户资料接口。
  // 复用 B 站评论头像悬停卡片的静态图片：每个图标只添加一个 img，同一 URL 由浏览器缓存共享。
  function injectSex(userInfo: any): boolean {
    if (!SHOW_SEX) return false
    const sr = userInfo.shadowRoot
    if (!sr || sr.querySelector('.bilikit-sex')) return false
    const userName = sr.querySelector('#user-name')
    const sex = normalizeCommentSex(userInfo.data?.member?.sex)
    if (!userName || !sex) return false
    const icon = document.createElement('img')
    icon.className = 'bilikit-sex'
    icon.src = commentSexIconUrl(sex)
    icon.width = 16
    icon.height = 16
    icon.alt = ''
    icon.decoding = 'async'
    icon.draggable = false
    icon.title = sex
    icon.setAttribute('role', 'img')
    icon.setAttribute('aria-label', sex)
    icon.style.cssText = 'display:block;flex:0 0 16px;width:16px;height:16px;margin-left:6px;object-fit:contain;vertical-align:middle;'
    userName.after(icon)
    return true
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
  function injectLocation(ab: any): boolean {
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
    // 换视频重绑：先断开上一棵评论树的所有观察器（否则旧树被观察器吊住、随会话累积）。
    // observed WeakSet 无需重置——旧 root 已脱离、随之可 GC，新 root 是新对象、天然不在集合里。
    for (const o of observers) o.disconnect()
    observers = []
    topRoot = sr
    observeRoot(sr) // 顶层：懒加载新批次；更深展开由 walk 逐层挂的观察者捕获
    walk(sr) // 首扫
    log('已绑定 bili-comments')
  }

  // 引导：等 #commentapp 里的 bili-comments 出现；SPA 换视频后换宿主则重绑。
  let current: any = null
  let currentApp: Element | null = null
  let appObserver: MutationObserver | null = null

  function releaseCommentTree(): void {
    for (const o of observers) o.disconnect()
    observers = []
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
    current = null
    topRoot = null
  }

  function tryBind(): void {
    const c = currentApp?.querySelector('bili-comments')
    if (c && c !== current && (c as any).shadowRoot) { current = c; bind(c) }
  }

  function watch(app: Element): void {
    if (app === currentApp && appObserver) { tryBind(); return }
    appObserver?.disconnect()
    releaseCommentTree()
    currentApp = app
    appObserver = new MutationObserver(tryBind)
    appObserver.observe(app, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-params'],
    })
    tryBind()
  }

  function ensureApp(): void {
    if (currentApp?.isConnected) return
    if (currentApp) {
      appObserver?.disconnect()
      appObserver = null
      currentApp = null
      releaseCommentTree() // 整个 #commentapp 被 SPA 换掉：立即断开旧 Shadow 树并放弃强引用
    }
    const app = document.querySelector('#commentapp')
    if (app) watch(app)
  }
  ensureApp()
  // Core 会跨 B 站 SPA 路由长期存活：在非视频页停留很久后仍可能无刷新进入视频页，
  // 因此不能用“初始 20s 后永久停止”的引导。2s 一次只读 isConnected；缺宿主时才做一次
  // querySelector，这比观察整个 document 低成本，也保证整个 #commentapp 被替换后最迟 2s 释放旧 Shadow 树。
  setInterval(() => {
    if (currentApp?.isConnected) return
    ensureApp()
  }, 2000)

  log('已启动')
}

export const commentLocation: BiliKitModule = {
  id: 'comment-location',
  name: '评论信息',
  description: '姓名旁显示性别，时间旁显示 IP 属地',
  category: '界面',
  runAt: 'idle',
  settings: [
    { key: 'showSex', type: 'toggle', label: '姓名旁显示性别', default: true, hint: '直接读取评论已有数据；保密用户不显示，不额外请求接口' },
    { key: 'pin', type: 'text', label: '地名前缀符', default: '', placeholder: '如 📍 ', hint: '显示在属地前，默认无；想加自己填' },
  ],
  init,
}
