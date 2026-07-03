import { register, runAll } from './core/module'
import { mountPanel } from './core/panel'
import { cdnPick } from './modules/cdn-pick'
import { noTrack } from './modules/no-track'
import { themeSync } from './modules/theme-sync'
import { commentLocation } from './modules/comment-location'
import { wakeLock } from './modules/wake-lock'

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

// 注册所有 Core（页面世界，@grant none）模块。
// cdn-pick / theme-sync 先跑（runAt='start'，需在页面用 fetch / 首帧换肤前挂钩）。
// 暂缓：float / way-back（与将来的 App 推荐 feed 有交互冲突，待 feed 定后再迁）；
//       quality-watch / home-clean（尚未上线）。
register(
  cdnPick,
  noTrack,
  themeSync,
  commentLocation,
  wakeLock,
)

runAll()

// 左下悬浮齿轮 + 设置面板（仅顶层窗口）
mountPanel()
