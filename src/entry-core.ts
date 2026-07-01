import { register, runAll } from './core/module'
import { mountPanel } from './core/panel'
import { cdnPick } from './modules/cdn-pick'
import { themeSync } from './modules/theme-sync'
import { commentLocation } from './modules/comment-location'
import { wakeLock } from './modules/wake-lock'

// 注册所有 Core（页面世界，@grant none）模块。
// cdn-pick / theme-sync 先跑（runAt='start'，需在页面用 fetch / 首帧换肤前挂钩）。
// 暂缓：float / way-back（与将来的 App 推荐 feed 有交互冲突，待 feed 定后再迁）；
//       quality-watch / home-clean（尚未上线）。
register(
  cdnPick,
  themeSync,
  commentLocation,
  wakeLock,
)

runAll()

// 左下悬浮齿轮 + 设置面板（仅顶层窗口）
mountPanel()
