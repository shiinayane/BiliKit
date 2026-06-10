# BiliKit

> 一套 B 站增强油猴脚本(Userscript)。纯脚本、零构建、无需浏览器扩展，对 **macOS Safari** 友好。

每个脚本独立安装、各管一摊；放在一个仓库里共享品牌与文档。各脚本注入语境不同（运行时机 / 匹配范围 / 是否进子框架），故**不合并为单文件**，而是作为套件分发。

## 脚本一览

| 脚本 | 作用 | 匹配范围 | 运行时机 |
|------|------|----------|----------|
| [**浮窗抽屉** · Float](scripts/float.user.js) | 点视频 → 页内抽屉播放，不跳转 | `www` / `search` | document-idle · 仅顶层 |
| [**主题同步** · Theme Sync](scripts/theme-sync.user.js) | 系统深浅色 → B 站，无刷新实时切换、跨 Tab 同步 | 全 `*.bilibili.com` | document-start · 仅顶层 |
| [**防睡眠** · Wake Lock](scripts/wake-lock.user.js) | 播放视频时防息屏/睡眠 | `/video/*` | document-idle · 进子框架 |
| [**回程** · Way Back](scripts/way-back.user.js) | 站内跨视频历史压扁，左下角回退栈点击跳回续播，左滑原生关标签页 | `/video/*` `/bangumi/play/*` | document-start · 仅顶层 |
| [**清晰度自适应** · Adaptive Quality](scripts/quality-watch.user.js) | 替代会卡死的「自动」：稳妥起步、网速好升档、卡顿降档 | `/video/*` `/bangumi/play/*` | document-idle · 进子框架 |
| [**CDN 优选** · CDN Pick](scripts/cdn-pick.user.js) | 把取流重定向到快镜像，绕开慢节点/回源失败的海外 CDN | `/video/*` `/bangumi/play/*` `player` | document-start · 进子框架 |

## 安装

1. 安装脚本管理器：[Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) /（Safari）[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)。
2. 按需打开 `scripts/` 下的 `*.user.js`，由脚本管理器识别安装。装哪个用哪个，互不依赖。

> ⚠️ **升级提示**：浮窗抽屉曾用名 `Bilibili-Float`。若你装过旧版，改名后脚本管理器会当成新脚本并存 →「点一下开两个抽屉」。请到管理器里**删掉旧的 `Bilibili-Float`**。脚本内已加单例守卫兜底，但仍建议手动清理。

## 协同关系

- **防睡眠 / 清晰度自适应 / CDN 优选 × 浮窗抽屉**：这三者**进子框架**，会自然在抽屉的 iframe 内生效——抽屉里看视频同样防息屏、自适应清晰度、走优选 CDN。
- **主题同步 × 浮窗抽屉**：主题同步**仅顶层运行**，不进抽屉 iframe；抽屉内主题由浮窗抽屉自己镜像宿主页（切主题时抽屉**实时跟随、无刷新**）。
- **回程 × 浮窗抽屉**：回程在浮窗抽屉在场时让位——抽屉接管视频点击（不导航），回程只管 SPA 历史压扁与回退栈，不与抽屉抢点击。

---

## 浮窗抽屉 · Float

点击视频卡 → 全屏抽屉从右滑入、iframe 内播放**完整**视频页（弹幕/评论/推荐/高清全有），不跳转新标签或当前页，首页状态、滚动位置全保留。

**交互**
- 关闭：触控板**两指右滑（跟手拖拽，过半滑出、不足回弹）** / 浏览器后退键 / `Esc` / 右下角关闭按钮。打开时压一条历史记录，接管后退手势。
- 保留 `Ctrl/Cmd/中键` 点击的浏览器默认行为（新标签打开）。
- 右下角「↗ 新标签打开」：带当前播放进度 `?t=` 续播 + 关闭抽屉，避免双重播放（开新标签时临时摘走回程的回退栈键，防被克隆）。

**体验**
- 自动播放、封面占位图（点开即有画面，不黑屏）、加载遮罩跟随系统深浅、悬停预连接。
- 抽屉内自注入净化 CSS，隐藏广告位 / B 站顶栏（同源注入，**不依赖广告屏蔽扩展** —— 专治 Safari / uBlock Origin Lite 无法注入子框架）。
- 开着抽屉切系统主题，抽屉内**无刷新**跟随。

**配置**（脚本顶部 `CONFIG`）

| 字段 | 说明 | 默认 |
|------|------|------|
| `mode` | 形态：`'fullscreen'` / `'modal'` / `'drawer-bottom'` / `'drawer-right'` / `'drawer-left'` | `'fullscreen'` |
| `backdrop` | 遮罩：`'plain'` / `'blur'` / `'none'` | `'plain'` |
| `swipeToClose` / `swipeBackDeltaXSign` | 滑动关闭开关 / 方向（`-1`=向右滑） | `true` / `-1` |
| `newTabResumeTime` / `newTabClosesDrawer` | 新标签续播 / 打开后关抽屉 | `true` / `true` |
| `autoPlayInDrawer` | 进抽屉自动播放 | `true` |
| `hideHeaderInDrawer` / `headerSelectors` | 隐藏 iframe 内 B 站顶栏 / 其选择器 | `true` |
| `syncDrawerTheme` | 开着抽屉时主题实时跟随 | `true` |
| `cleanAds` / `adSelectors` | 抽屉内净化广告 / 其选择器清单 | `true` |
| `coverPlaceholder` / `preconnectOnHover` | 封面占位 / 悬停预连接 | `true` |
| `zIndex` | 层级 | `2147483600` |

> **可嵌入原理**：B 站视频页不发 `X-Frame-Options` / `CSP frame-ancestors`，且与脚本同源，可直接 `<iframe>` 嵌入并访问 `contentDocument`。

## 主题同步 · Theme Sync

让 B 站跟随**系统**深浅色，全站（首页 + 播放页）**无刷新实时切换**，并自动同步所有标签页。

**主题原理（实测）**：B 站换肤的本质 = 切换主题样式表 `<link>` 的 href：
`…/bili-theme/light.css ↔ dark.css`（这张表定义全站 CSS 变量，首页与播放页通用）。本脚本即模仿此机制：
- 切换该 `<link>` 的 href → 全站含播放器**瞬间换肤、无刷新**；
- 同步 toggle `<html>` 的 `bili_dark` / `night-mode` 标记类；
- 写 `theme_style` cookie，保证新页面 / 新 Tab 的初始主题；`document-start` 给 `<html>` 垫深色底，消除整页加载的「闪白」；
- `prefers-color-scheme` 变化时实时切（每 Tab 各自触发，天然跨 Tab），`visibilitychange` 兜底后台冻结的标签页。

> 跟随的是**系统**主题；若你单独用 B 站菜单改主题，会在下次应用时被改回系统值（设计如此）。

## 防睡眠 · Wake Lock

用 `navigator.wakeLock` 在视频**播放时**申请屏幕常亮，暂停 / 结束时释放。捕获阶段代理 `playing` 事件接管任意 `<video>`（换 P / 播放器重建后的新元素一开播即接管，免高频 `MutationObserver`）；停播信号直挂被接管元素（B 站重建播放器会把元素移出 DOM，document 捕获听不到）；页面隐藏时不申请（系统会自动释放），切回可见时自动重申。

## 回程 · Way Back

视频标签页里连跳了很多视频后，「回到之前某个视频」和「看完离开」都不该靠一格格按返回。

- **历史压扁（仅 SPA）**：站内跨视频跳转由 B 站自己的 pushState 完成，包一层改写成 replaceState——零重载、历史深度钉在 1。由此白赚 Safari 原生行为：链接自动新开的标签页历史为 1 时，**两指左滑 = 关闭标签页并回到来源页**，「关闭」不归脚本管、零误触。
- **回退栈**：左下角常驻胶囊「↩ N」（0 层灰显）。悬停展开列表，序号 0 是「你在这里」（带播放指示），向上 1/2/3… 即「往回退几层」。点任意一项跳回并 `?t=` 续播；点胶囊回退一层。
- 不拦截点击，让 B 站原生 SPA 切换照常丝滑；与浮窗抽屉协同（抽屉在场时让位）。

## 清晰度自适应 · Adaptive Quality

替代 B 站那个一上来就顶 4K、网速扛不住就卡死的「自动」。闭环爬山，只靠 `<video>` 信号：

- **接管自动**：从稳妥起步档（默认 1080P）起步，绝不一上来就 4K；已是合理手动档则原样接管、不打扰。
- **卡顿降档**：缓冲见底（只认 `waiting` 且缓冲确实低，免疫 MSE 的 `stalled` 噪声）→ 立刻降一档，反复扛不住的档冷却递增。
- **平稳升档**：缓冲稳在安全线之上、无卡顿持续够久 → 升一档。
- 换档非无缝（B 站换流约 1s 重缓冲），故切档有宽限期，不误判。

**配置**：`floorQn`（地板，默认 480P）/ `ceilQn`（天花板，默认 4K，可设 116 禁 4K）/ `startQn` / `allowVipTiers`。

## CDN 优选 · CDN Pick

把视频取流重定向到你指定的 CDN 镜像，绕开 B 站默认分给你的慢节点（海外党常被分到的 Akamai，或对冷门/新视频**回源失败**的节点）。

- 拦截 playurl（首帧 `__playinfo__` + 换片/切档接口），把视频/音频源换成 `TARGET_HOST`，并把**备份列表整列重建为大陆镜像**，彻底清掉 akam/cosov——否则主镜像一打嗝，播放器就轮到备份的慢节点、URL 反复横跳。
- 只改 bilivideo 系（upos 签名与主机名无关、可互换）；绝不把 Akamai 的 hdnts 地址套到 bilivideo 主机（会 403）。
- **Safari 关键**：`@grant none`、页面世界注入，能拦到播放器真正的请求——而 CCB 这类脚本在 Safari Userscripts 下因 grant 被强制注入隔离世界、hook 不到页面 fetch 而失效。

**配置**：`TARGET_HOST`（主镜像，改一行换节点、置空关闭）/ `BACKUP_HOSTS`。最优镜像随地区/线路而异，**按真实下载吞吐、用视频流样本**自测——见 [`test/cdn-benchmark.md`](test/cdn-benchmark.md) 与 [`test/cdnbatch.sh`](test/cdnbatch.sh)。

---

## 设计取舍备忘

- **抽屉加载的是完整视频页**（非嵌入播放器）：换来高清 + 评论 + 弹幕齐全，代价是比轻量播放器重。曾试「悬停预热整页」提速，但内存占用过高已回退，仅保留零成本的悬停预连接。
- **原生左滑返回手势**对页内浮层（同文档 pushState）无效，故浮窗抽屉用 `wheel` 自行实现跟手关闭；而回程反过来利用它——把历史压扁到深度 1，让 Safari 的原生左滑变成「关闭标签页」。
- **海外卡顿的根因是回源，不是带宽/IP**：实测日本 50M 宽带、CDN 边缘 9ms 本地可达，但冷门/新视频在海外节点回源慢甚至失败（HTTP 514）。解法是 CDN 优选指到回源快的大陆镜像，而非优选 IP（边缘已是最优）。延迟会骗人，选镜像须测真实吞吐。
- **音频均衡/响度均衡不可行**：Safari 上 `createMediaElementSource` 接管 B 站 MSE 视频后 AnalyserNode 读到全零（WebKit 路由 bug），故不做此类脚本。

## 路线图

- [x] 脚本归入 BiliKit 套件、统一品牌、加单例守卫
- [x] 主题：swap 样式表实现全站无刷新切换
- [x] 浮窗抽屉：跟手式滑动关闭
- [x] 回程：历史压扁 + 回退栈 + 左滑原生关标签页
- [x] 清晰度自适应：闭环爬山
- [x] CDN 优选：playurl 改写 + 多样本吞吐实测选镜像
- [ ] 浮窗抽屉：设置面板 / 更多页面适配（动态、空间页、收藏夹）
- [ ] 浮窗抽屉：可选 Document Picture-in-Picture 浮窗模式
- [ ] 出现共享代码诉求后，迁移到 `vite-plugin-monkey` 工程

## License

[MIT](LICENSE) © shiinayane
