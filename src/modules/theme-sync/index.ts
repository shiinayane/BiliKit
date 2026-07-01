import type { BiliKitModule, Cfg } from '../../core/module'

/**
 * 主题同步：让 B 站跟随系统深浅色，全站无刷新实时切换并同步所有 Tab。
 * 迁移自 scripts/theme-sync.user.js（逻辑逐字保留）。
 * 只在顶层窗口跑（跳过 Float 抽屉 iframe），故保留 window.top 守卫。
 */
function init(cfg: Cfg): void {
  // 仅在顶层窗口运行：避免跑进 BiliKit·Float 的抽屉 iframe（其主题由 Float 自行处理）。
  if (window.top !== window.self) return

  // 单例守卫：防止与仍在用的旧独立脚本共存时重复设 cookie / 重复换肤。
  if ((window as any).__BILIKIT_THEME_SYNC__) return
  ;(window as any).__BILIKIT_THEME_SYNC__ = true

  const COOKIE_NAME = 'theme_style'
  const COOKIE_DOMAIN = '.bilibili.com'
  const THEME_LINK_RE = /\/bili-theme\/(light|dark)\.css/ // 命中主题样式表（不含 light_u.css 等基础表）

  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const systemDark = () => !!(mql && mql.matches)
  // 主题模式：'auto' 跟随系统 / 'dark' 始终深 / 'light' 始终浅（面板可调；每次 apply 时读取）
  const wantDark = () => {
    const mode = cfg.get<string>('mode') || 'auto'
    if (mode === 'dark') return true
    if (mode === 'light') return false
    return systemDark()
  }

  // document.cookie 写入是同步操作，apply() 在每次切回标签页时都会跑，值没变就跳过
  let lastCookieValue: string | null = null
  function setCookie(name: string, value: string): void {
    if (value === lastCookieValue) return
    lastCookieValue = value
    document.cookie = `${name}=${value}; path=/; domain=${COOKIE_DOMAIN}; max-age=31536000; SameSite=Lax`
  }

  // 切换主题样式表 href（light.css ↔ dark.css）。幂等：href 已正确则不动（不触发重新下载）。
  function swapThemeStylesheet(doc: Document, dark: boolean): void {
    const want = dark ? '/dark.css' : '/light.css'
    for (const link of doc.querySelectorAll('link[rel="stylesheet"]') as any) {
      if (!THEME_LINK_RE.test(link.href)) continue
      if (!link.href.includes(want)) link.href = link.href.replace(/\/(light|dark)\.css/, want)
    }
  }

  // 让 B 站评论等 Web Component 跟随主题：它们用自身 reactive 的 `theme` 属性控制 Shadow DOM 内主题
  // （如「UP主觉得很赞」标签），不读全站 CSS 变量/cookie——换样式表换不动，必须直接设 .theme。
  // 只在值不符时写，平时近乎零成本，也不与 B 站自己的换肤打架（设成同值它不会反复触发）。
  function syncComponentTheme(dark: boolean): void {
    const want = dark ? 'dark' : 'light'
    for (const el of document.querySelectorAll('bili-comments') as any) {
      try { if (el.theme !== want) el.theme = want } catch (_) {}
    }
  }

  function apply(): void {
    const dark = wantDark()
    setCookie(COOKIE_NAME, dark ? 'dark' : 'light') // 持久化：保证后续加载的初始主题
    swapThemeStylesheet(document, dark) // 当前页：无刷新换肤（document-start 时表可能还没插入，由后续时机兜底）
    const root = document.documentElement
    root.classList.toggle('bili_dark', dark)
    root.classList.toggle('night-mode', dark)
    // 整页加载首帧在主题表就绪前是白底，深色下「闪白」；document-start 给 <html> 垫深色底，首帧即深色。
    root.style.backgroundColor = dark ? '#18191c' : ''
    syncComponentTheme(dark) // 评论等组件的私有主题通道，单独同步
  }

  apply() // document-start
  // 主题表通常在 document-start 之后才插入 <head>，故 DOMContentLoaded 再纠正一次（幂等）
  document.addEventListener('DOMContentLoaded', apply)

  // 系统主题变化：每个 Tab 各自触发，天然跨 Tab 同步
  if (mql) {
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', apply)
    else if (typeof (mql as any).addListener === 'function') (mql as any).addListener(apply) // 旧浏览器回退
  }

  // 兜底：标签页从后台/冻结恢复可见时补一次，处理冻结期间错过的 change 事件
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') apply()
  })

  // 评论宿主懒加载、SPA 换视频后会重建，新元素带的是 B 站自己（可能过期）的主题值；
  // 轻量观察 DOM 增删，有新组件就补设一次（rAF 合并；只在 .theme 不符时才写，平时近乎零成本）。
  let syncPending = 0
  const scheduleComponentSync = () => {
    if (syncPending) return
    syncPending = requestAnimationFrame(() => { syncPending = 0; syncComponentTheme(wantDark()) })
  }
  new MutationObserver(scheduleComponentSync).observe(document.documentElement, { childList: true, subtree: true })
}

export const themeSync: BiliKitModule = {
  id: 'theme-sync',
  name: '主题同步',
  description: '跟随系统深浅色，全站无刷新实时切换',
  category: '界面',
  runAt: 'start',
  settings: [
    {
      key: 'mode',
      type: 'select',
      label: '主题模式',
      default: 'auto',
      options: [
        { label: '跟随系统', value: 'auto' },
        { label: '始终深色', value: 'dark' },
        { label: '始终浅色', value: 'light' },
      ],
      hint: '跟随系统深浅，或强制固定一种',
    },
  ],
  init,
}
