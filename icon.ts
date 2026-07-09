// BiliKit 图标 data-URI（自包含，供 Core/Feed 两个 userscript 的 `@icon`，脚本管理器离线也显示）。
// SVG 内容与 assets/logo.svg 一致（此处为省去元数据的内联精简版）——logo 极少变动，改 logo 时两处一起改。
// 内联而非 `readFileSync` 读文件：让 icon.ts 不依赖 `node:*`，从而在「纯浏览器类型（types:[]、无 @types/node）」
// 的 tsc typecheck 下也能通过（icon.ts 会被 vite.config.ts 的 import 拉进 typecheck 范围）。
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<rect width="512" height="512" rx="116" fill="#FB7299"/>' +
  '<g stroke="#fff" stroke-width="26" stroke-linecap="round">' +
  '<line x1="212" y1="182" x2="166" y2="104"/><line x1="300" y1="182" x2="346" y2="104"/></g>' +
  '<rect x="108" y="176" width="296" height="236" rx="54" fill="#fff"/>' +
  '<path d="M234 258 302 294 234 330Z" fill="#00AEEC" stroke="#00AEEC" stroke-width="18" stroke-linejoin="round" stroke-linecap="round"/>' +
  '</svg>'
// encodeURIComponent 后即为合法 data-URI（# → %23 等），Tampermonkey / Safari Userscripts 均识别
export const ICON = 'data:image/svg+xml,' + encodeURIComponent(SVG)
