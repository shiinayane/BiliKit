import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

// BiliKit Core：@grant none（页面世界）——所有增强模块 + 统一设置面板打进一个 .user.js。
// 不使用任何 GM_* API，vite-plugin-monkey 会自动输出 `// @grant none`，从而在 Safari
// Userscripts 下注入页面世界（评论属地/CDN 优选/回程/主题同步等模块读页面 JS 的前提）。
// App 推荐 feed 需要 GM.xmlHttpRequest（隔离世界），将来单独一个入口/产物，勿并入本包。
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/entry-core.ts',
      userscript: {
        name: 'BiliKit',
        namespace: 'https://github.com/shiinayane/BiliKit',
        version: '0.2.0',
        description: 'BiliKit · B 站增强套件（核心）：CDN 优选 / 主题同步 / 评论属地 / 防睡眠 + 统一设置面板。Safari 友好、页面世界注入、无外部依赖。',
        author: 'shiinayane',
        license: 'MIT',
        // 全站匹配：theme-sync 本就全站换肤，cdn-pick 需覆盖 player.bilibili.com；
        // 其余模块靠自身 observer/轮询自适配页面类型，非相关页自动 no-op。
        match: [
          '*://*.bilibili.com/*',
        ],
        'run-at': 'document-start',
        // 显式 @grant none —— Safari Userscripts 据此把脚本注入「页面世界」，
        // 是评论属地/CDN 优选/回程/主题同步等模块读写页面 JS 的前提。缺了它 monkey 不会输出该行。
        grant: 'none',
      },
      build: {
        fileName: 'bilikit-core.user.js',
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
})
