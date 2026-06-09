# BiliKit

> 一套 B 站增强油猴脚本(Userscript)。纯脚本、零构建、无需浏览器扩展，对 Safari 友好。

每个脚本独立安装、各管一摊；放在一个仓库里共享品牌与文档。三者注入语境不同(运行时机 / 匹配范围 / 是否进子框架)，故**不合并为单文件**，而是作为套件分发。

## 脚本一览

| 脚本 | 作用 | 匹配范围 | 运行时机 |
|------|------|----------|----------|
| [**Float · 浮窗抽屉**](scripts/float.user.js) | 点视频 → 页内全屏抽屉播放，不跳转 | `www` / `search` | document-idle（仅顶层） |
| [**Theme Sync · 主题同步**](scripts/theme-sync.user.js) | 系统深浅色 → B 站，无刷新实时切换、跨 Tab 同步 | 全 `*.bilibili.com` | document-start（仅顶层） |
| [**Wake Lock · 防睡眠**](scripts/wake-lock.user.js) | 播放视频时防息屏/睡眠 | `/video/*` | document-idle |

## 安装

1. 安装脚本管理器：[Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) /（Safari）[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)。
2. 按需打开 `scripts/` 下的 `*.user.js`，由脚本管理器识别安装。装哪个用哪个，互不依赖。

> ⚠️ **升级提示**：脚本曾用名 `Bilibili-Float`。若你装过旧版，改名后脚本管理器会当成新脚本并存 →「点一下开两个抽屉」。请到管理器里**删掉旧的 `Bilibili-Float`**。脚本内已加单例守卫兜底，但仍建议手动清理。

## 协同关系

- **Wake Lock × Float**：防睡眠匹配 `/video/*`，会自然在 Float 的抽屉 iframe 内生效 —— 抽屉里看视频也防息屏。
- **Theme Sync × Float**：主题同步**仅顶层运行**，不进抽屉 iframe；抽屉内主题由 Float 自己镜像宿主页（切主题时抽屉**实时跟随、无刷新**）。

---

## Float · 浮窗抽屉

点击视频卡 → 全屏抽屉从右滑入、iframe 内播放**完整**视频页（弹幕/评论/推荐/高清全有），不跳转新标签或当前页，首页状态、滚动位置全保留。

**交互**
- 关闭：触控板**两指右滑（跟手拖拽，过半滑出、不足回弹）** / 浏览器后退键 / `Esc` / 右下角关闭按钮。打开时压一条历史记录，接管后退手势。
- 保留 `Ctrl/Cmd/中键` 点击的浏览器默认行为（新标签打开）。
- 右下角「↗ 新标签打开」：带当前播放进度 `?t=` 续播 + 关闭抽屉，避免双重播放。

**体验**
- 自动播放、封面占位图（点开即有画面，不黑屏）、加载遮罩跟随系统深浅、悬停预连接。
- 抽屉内自注入净化 CSS，隐藏广告位 / B 站顶栏（同源注入，**不依赖广告屏蔽扩展** —— 专治 Safari / uBlock Origin Lite 无法注入子框架）。
- 开着抽屉切系统主题，抽屉内**无刷新**跟随（见下「主题原理」）。

**配置**（脚本顶部 `CONFIG`）

| 字段 | 说明 | 默认 |
|------|------|------|
| `mode` | 形态：`'fullscreen'` / `'modal'` / `'drawer-bottom'` / `'drawer-right'` / `'drawer-left'` | `'fullscreen'` |
| `swipeToClose` / `swipeThreshold` / `swipeBackDeltaXSign` | 滑动关闭开关 / 回退阈值 / 方向（`-1`=向右滑） | `true` / `140` / `-1` |
| `newTabResumeTime` / `newTabClosesDrawer` | 新标签续播 / 打开后关抽屉 | `true` / `true` |
| `autoPlayInDrawer` | 进抽屉自动播放 | `true` |
| `hideHeaderInDrawer` / `headerSelectors` | 隐藏 iframe 内 B 站顶栏 / 其选择器 | `true` |
| `syncDrawerTheme` | 开着抽屉时主题实时跟随 | `true` |
| `cleanAds` / `adSelectors` | 抽屉内净化广告 / 其选择器清单 | `true` |
| `coverPlaceholder` / `preconnectOnHover` | 封面占位 / 悬停预连接 | `true` |
| `zIndex` | 层级 | `2147483600` |

> **可嵌入原理**：B 站视频页不发 `X-Frame-Options` / `CSP frame-ancestors`，且与脚本同源，可直接 `<iframe>` 嵌入并访问 `contentDocument`。

## Theme Sync · 主题同步

让 B 站跟随**系统**深浅色，全站（首页 + 播放页）**无刷新实时切换**，并自动同步所有标签页。

**主题原理（实测）**：B 站换肤的本质 = 切换主题样式表 `<link>` 的 href：
`…/bili-theme/light.css ↔ dark.css`（这张表定义全站 CSS 变量，首页与播放页通用）。本脚本即模仿此机制：
- 切换该 `<link>` 的 href → 全站含播放器**瞬间换肤、无刷新**；
- 同步 toggle `<html>` 的 `bili_dark` / `night-mode` 标记类；
- 写 `theme_style` cookie（`dark`/`light`），保证新页面 / 新 Tab 的初始主题；
- `document-start` 抢渲染前应用，`prefers-color-scheme` 变化时实时切（每 Tab 各自触发，天然跨 Tab），`visibilitychange` 兜底后台冻结的标签页。

> 跟随的是**系统**主题；若你单独用 B 站菜单改主题，会在下次应用时被改回系统值（设计如此）。

## Wake Lock · 防睡眠

用 `navigator.wakeLock` 在视频**播放时**申请屏幕常亮，暂停 / 结束时释放；`MutationObserver` 跟踪换 P / 播放器重建；页面隐藏时不申请（系统会自动释放），切回可见时自动重申。

---

## 设计取舍备忘

- **抽屉加载的是完整视频页**（非嵌入播放器）：换来高清 + 评论 + 弹幕齐全，代价是比轻量播放器重。曾试「悬停预热整页」提速，但内存占用过高已回退，仅保留零成本的悬停预连接。
- **原生左滑返回手势**对页内浮层（同文档 pushState）无效，故用 `wheel` 自行实现跟手关闭；需系统「在页面间轻扫」不抢占 wheel 事件。

## 路线图

- [x] 三脚本归入 BiliKit 套件、统一品牌、加单例守卫
- [x] 主题：swap 样式表实现全站无刷新切换
- [x] Float：跟手式滑动关闭
- [ ] Float：设置面板 / 更多页面适配（动态、空间页、收藏夹）
- [ ] Float：可选 Document Picture-in-Picture 浮窗模式
- [ ] 出现共享代码诉求后，迁移到 `vite-plugin-monkey` 工程

## License

[MIT](LICENSE) © shiinayane
