// BiliKit 图标：从 assets/logo.svg（单一事实来源）在 build 期生成自包含 data-URI，
// 供 Core/Feed 两个 userscript 的 `@icon` 使用——脚本管理器里离线也能显示图标，不依赖任何外链。
// 改 logo 只动 assets/logo.svg 一处；两个 vite 配置都 import 本文件。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const svg = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'assets/logo.svg'), 'utf8')
// encodeURIComponent 后即为合法 data-URI（# → %23 等），Tampermonkey / Safari Userscripts 均识别
export const ICON = 'data:image/svg+xml,' + encodeURIComponent(svg)
