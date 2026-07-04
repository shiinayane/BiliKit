import { register, runAll } from './core/module'
import { syncSharedSettings } from './core/settings'
import { mountPanel } from './core/panel'
import { cdnPick } from './modules/cdn-pick'
import { themeSync } from './modules/theme-sync'
import { commentLocation } from './modules/comment-location'
import { wakeLock } from './modules/wake-lock'
import { noLogin } from './modules/no-login'
import { wayBack } from './modules/way-back'
import { installSiteDrawer } from './modules/site-drawer'

// 跨子域对齐设置：把 .bilibili.com cookie 里的共享设置并回本域 localStorage（www/search/space 用同一份），
// 老用户则反向种一次 cookie。必须在任何模块读设置（runAll）之前。
syncSharedSettings()

// 心跳：与 Feed 同源共享 localStorage，写入本次运行时间戳，供 Feed 判断 Core 是否已安装并在跑。
try { localStorage.setItem('bilikit:alive.core', String(Date.now())) } catch { /* 隐私模式忽略 */ }

// 在 BiliKit 抽屉的 iframe 内（父页给 URL 打了 #bk-drawer 标记）隐藏站内顶栏 + 广告位，让播放器占满。
// 只在「子框架 + 标记」时生效；Core @run-at document-start，注入的样式先于渲染就位，不闪。
// 广告选择器沿用原 float 脚本的清单。
function hideDrawerChrome(): void {
  if (window.top === window.self || !location.hash.includes('bk-drawer')) return
  const ads = ['.ad-report', '.video-page-special-card-small', '.video-page-game-card-small', '.slide-ad-exp', '.activity-m-v1', '.pop-live-small-mode', '.right-bottom-banner', '.eva-banner', '.gg-floor-module', '.video-card-ad-small']
  const s = document.createElement('style')
  s.textContent =
    `#biliMainHeader,.bili-header,.fixed-header,.international-header{display:none!important}` +
    ads.join(',') + `{display:none!important}`
  ;(document.head || document.documentElement).appendChild(s)
}
hideDrawerChrome()

// 抽屉内（父页打 #bk-drawer / #bk-drawer-web）：单个轮询循环同时干两件揭幕相关的事，跑完即停：
//   ① 首帧就绪 → postMessage('bk-drawer-ready')：Feed 据此撤加载遮罩。以 readyState≥2(HAVE_CURRENT_DATA)
//      或 loadeddata/canplay 为准——比等真正开播(currentTime>0)更早，抢在出声前揭幕、声音不先于画面。
//   ② 仅 -web 模式：点一次原生「网页全屏」按钮让播放器铺满抽屉，铺满(data-screen=web)后 postMessage('bk-drawer-webfull')。
//      网页全屏是纯页面布局(非 OS 全屏)，无需用户手势。**只点一次**：点了不停手，靠后续 tick 确认 data-screen=web，
//      绝不再点——否则再点一次会把网页全屏切回去、来回横跳。
// 合成一个 interval（而非两个并发）省掉重复 querySelector；ready 与 web 都完成或超时即 clearInterval，不留常驻定时器。
function setupDrawerReveal(): void {
  if (window.top === window.self || !location.hash.includes('bk-drawer')) return
  const wantWeb = location.hash.includes('bk-drawer-web')
  // targetOrigin 用 '*'：抽屉从 search/space 等子域打开时，父页 origin 与本 iframe(www) 不同，
  // 用 location.origin 会导致信号被浏览器丢弃 → 父页收不到、只能等 6s 兜底（揭幕很晚）。信号非敏感，'*' 即可。
  const post = (m: string): void => { try { window.parent.postMessage(m, '*') } catch { /* 忽略 */ } }
  let readyDone = false
  let webDone = !wantWeb // 普通抽屉无需铺满，直接算完成
  let bound = false
  let clicked = false
  let tries = 0
  const onReady = (): void => { if (readyDone) return; readyDone = true; post('bk-drawer-ready') }
  const timer = setInterval(() => {
    if (!readyDone) {
      const v = document.querySelector('video') as HTMLVideoElement | null
      if (v) {
        if (v.readyState >= 2) onReady() // 首帧已就绪 → 立刻揭幕
        else if (!bound) { bound = true; v.addEventListener('loadeddata', onReady, { once: true }); v.addEventListener('canplay', onReady, { once: true }) } // 首帧一解出即揭，比轮询更即时
      }
    }
    if (!webDone) {
      if (document.querySelector('.bpx-player-container[data-screen="web"]')) { webDone = true; post('bk-drawer-webfull') } // 已铺满
      else if (!clicked) { const btn = document.querySelector('.bpx-player-ctrl-web') as HTMLElement | null; if (btn) { btn.click(); clicked = true } } // 只点一次
    }
    if ((readyDone && webDone) || ++tries > 60) clearInterval(timer) // 都完成或 ~9s 兜底（父页遮罩超时另有保底）
  }, 150)
}
setupDrawerReveal()

// 注册所有 Core（页面世界，@grant none）模块。
// cdn-pick / theme-sync 先跑（runAt='start'，需在页面用 fetch / 首帧换肤前挂钩）。
// 暂缓：float / way-back（与将来的 App 推荐 feed 有交互冲突，待 feed 定后再迁）；
//       quality-watch / home-clean（尚未上线）。
register(
  cdnPick,
  themeSync,
  commentLocation,
  wakeLock,
  noLogin, // 注册在 cdn-pick 之后：其 fetch/XHR 与 __playinfo__ hook 需叠在最外层（改请求；cdn-pick 改响应 host）
  wayBack, // 视频页回退栈胶囊（顶层 + 抽屉 iframe）
)

runAll()

// 全站抽屉：无独立开关，由「打开方式」驱动（当前页=不拦）。委托点击拦截，自守卫顶层窗口 + 幂等。
installSiteDrawer()

// 左下悬浮齿轮 + 设置面板（仅顶层窗口）
mountPanel()
