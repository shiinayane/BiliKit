// ==UserScript==
// @name         BiliKit · Theme Sync
// @name:zh-CN   BiliKit · 主题同步
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.4.2
// @description       Make Bilibili follow the system light/dark theme, switching live across the whole site with no reload and syncing every tab.
// @description:zh-CN 让 B 站跟随系统深浅色，全站无刷新实时切换并同步所有 Tab。
// @author       shiinayane
// @match        *://*.bilibili.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/573476/B%E7%AB%99%E4%B8%BB%E9%A2%98%E5%90%8C%E6%AD%A5.user.js
// @updateURL https://update.greasyfork.org/scripts/573476/B%E7%AB%99%E4%B8%BB%E9%A2%98%E5%90%8C%E6%AD%A5.meta.js
// ==/UserScript==

/*
 * 原理（实测）：
 * - B 站换肤的本质 = 切换主题样式表 <link> 的 href：
 *     …/bfs/seed/jinkela/short/bili-theme/light.css  ↔  …/dark.css
 *   这张表定义了全站 CSS 变量（--bg1 等），首页与播放页通用，换它即全站(含播放器)瞬间换肤、无刷新。
 * - 同时 toggle <html> 的 bili_dark / night-mode 标记类（部分组件/JS 读取它们）。
 * - theme_style cookie（dark/light）保证新页面/新 Tab 的初始主题。
 * - prefers-color-scheme 的 change 在每个 Tab 各自触发，天然跨 Tab 同步；visibilitychange 兜底冻结 Tab。
 */
(() => {
  'use strict';

  // 仅在顶层窗口运行：避免跑进 BiliKit·Float 的抽屉 iframe（其主题由 Float 自行处理）。
  if (window.top !== window.self) return;

  // 单例守卫：防止脚本被重复安装/注入导致重复设 cookie / 重复换肤。
  if (window.__BILIKIT_THEME_SYNC__) return;
  window.__BILIKIT_THEME_SYNC__ = true;

  const COOKIE_NAME = 'theme_style';
  const COOKIE_DOMAIN = '.bilibili.com';
  const THEME_LINK_RE = /\/bili-theme\/(light|dark)\.css/; // 命中主题样式表（不含 light_u.css 等基础表）

  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const systemDark = () => !!(mql && mql.matches);

  function setCookie(name, value) {
    document.cookie = `${name}=${value}; path=/; domain=${COOKIE_DOMAIN}; max-age=31536000; SameSite=Lax`;
  }

  // 切换主题样式表 href（light.css ↔ dark.css）。幂等：href 已正确则不动（不触发重新下载）。
  function swapThemeStylesheet(doc, dark) {
    const want = dark ? '/dark.css' : '/light.css';
    for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
      if (!THEME_LINK_RE.test(link.href)) continue;
      if (!link.href.includes(want)) link.href = link.href.replace(/\/(light|dark)\.css/, want);
    }
  }

  function apply() {
    const dark = systemDark();
    setCookie(COOKIE_NAME, dark ? 'dark' : 'light'); // 持久化：保证后续加载的初始主题
    swapThemeStylesheet(document, dark); // 当前页：无刷新换肤（document-start 时表可能还没插入，由后续时机兜底）
    const root = document.documentElement;
    root.classList.toggle('bili_dark', dark);
    root.classList.toggle('night-mode', dark);
  }

  apply(); // document-start
  // 主题表通常在 document-start 之后才插入 <head>，故 DOMContentLoaded 再纠正一次（幂等）
  document.addEventListener('DOMContentLoaded', apply);

  // 系统主题变化：每个 Tab 各自触发，天然跨 Tab 同步
  if (mql) {
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', apply);
    else if (typeof mql.addListener === 'function') mql.addListener(apply); // 旧浏览器回退
  }

  // 兜底：标签页从后台/冻结恢复可见时补一次，处理冻结期间错过的 change 事件
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') apply();
  });
})();
