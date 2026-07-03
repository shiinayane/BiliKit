// ==UserScript==
// @name         BiliKit Feed
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.2.1
// @author       shiinayane
// @description  B 站首页换成手机 App 的个性化推荐流。零框架纯原生实现（无 React/Vue、gzip 仅 ~16KB）+ 窗口化虚拟化，DOM 数量恒定、长时间刷不涨内存。点卡片在底部抽屉内播放、封面悬停秒预览。需配合 BiliKit Core（登录 / 设置）。
// @license      MIT
// @match        *://www.bilibili.com/
// @match        *://www.bilibili.com/?*
// @match        *://www.bilibili.com/index.html*
// @connect      app.bilibili.com
// @connect      api.bilibili.com
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function md5(s) {
    function add32(a, b) {
      return a + b & 4294967295;
    }
    function cmn(q, a, b, x, sh, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32(a << sh | a >>> 32 - sh, b);
    }
    function ff(a, b, c, d, x, s2, t) {
      return cmn(b & c | ~b & d, a, b, x, s2, t);
    }
    function gg(a, b, c, d, x, s2, t) {
      return cmn(b & d | c & ~d, a, b, x, s2, t);
    }
    function hh(a, b, c, d, x, s2, t) {
      return cmn(b ^ c ^ d, a, b, x, s2, t);
    }
    function ii(a, b, c, d, x, s2, t) {
      return cmn(c ^ (b | ~d), a, b, x, s2, t);
    }
    function cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);
      d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);
      b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]);
      x[1] = add32(b, x[1]);
      x[2] = add32(c, x[2]);
      x[3] = add32(d, x[3]);
    }
    function blk(str, i2) {
      const m = [];
      for (let j = 0; j < 64; j += 4) m[j >> 2] = str.charCodeAt(i2 + j) + (str.charCodeAt(i2 + j + 1) << 8) + (str.charCodeAt(i2 + j + 2) << 16) + (str.charCodeAt(i2 + j + 3) << 24);
      return m;
    }
    const n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) cycle(state, blk(s, i - 64));
    s = s.substring(i - 64);
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << (i % 4 << 3);
    tail[i >> 2] |= 128 << (i % 4 << 3);
    if (i > 55) {
      cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    cycle(state, tail);
    const hc = "0123456789abcdef";
    let out = "";
    for (const w of state) for (let j = 0; j < 4; j++) out += hc[w >> j * 8 + 4 & 15] + hc[w >> j * 8 & 15];
    return out;
  }
  const APPKEY = "4409e2ce8ffd12b8";
  const APPSEC = "59b43e04ad6965f34319062b478f83dd";
  function signAppQuery(params) {
    const p = { appkey: APPKEY, ...params };
    const sorted = Object.keys(p).sort().map((k) => `${k}=${encodeURIComponent(p[k])}`).join("&");
    return `${sorted}&sign=${md5(sorted + APPSEC)}`;
  }
  const redactKey = (u) => (u || "").replace(/(access_key=)[^&]*/i, "$1<redacted>");
  function gmRequest(opts) {
    const xhr = typeof GM !== "undefined" && GM && GM.xmlHttpRequest ? GM.xmlHttpRequest.bind(GM) : typeof GM_xmlhttpRequest !== "undefined" ? GM_xmlhttpRequest : null;
    if (!xhr) return Promise.reject(new Error("GM.xmlHttpRequest 不可用（Feed 需 @grant GM.xmlHttpRequest）"));
    return new Promise((resolve, reject) => {
      xhr({
        method: opts.method,
        url: opts.url,
        data: opts.data,
        headers: opts.headers || (opts.data ? { "Content-Type": "application/x-www-form-urlencoded" } : void 0),
        anonymous: opts.anonymous,
        // 不带 cookie —— passport 风控对带 web cookie 的请求会回 412 HTML
        timeout: 15e3,
        onload: (r) => {
          const t = r.responseText || "";
          if (t.trimStart().startsWith("<")) {
            console.error(
              "[BiliKit Feed] 非 JSON 响应（可能被风控/登录拦截）：",
              "status =",
              r.status,
              r.statusText,
              "url =",
              redactKey(r.finalUrl || opts.url),
              "\n  正文(前 300) =\n",
              t.slice(0, 300)
            );
          }
          resolve(t);
        },
        onerror: (r) => {
          console.error("[BiliKit Feed] onerror：", r && r.status);
          reject(new Error("网络错误"));
        },
        ontimeout: () => reject(new Error("请求超时")),
        onabort: () => reject(new Error("请求被中止"))
        // 否则中止时 Promise 永不 settle → 上游 loading 卡死
      });
    });
  }
  function descDate(desc) {
    if (!desc) return "";
    const i = desc.lastIndexOf(" · ");
    return i >= 0 ? desc.slice(i + 3).trim() : "";
  }
  function normalize(item) {
    if (!item || typeof item !== "object") return null;
    const args = item.args || {};
    const pa = item.player_args || {};
    return {
      goto: item.goto || "",
      title: item.title || "",
      up: args.up_name || "",
      mid: String(args.up_id || item.avatar && item.avatar.up_id || ""),
      face: item.avatar && item.avatar.cover || "",
      cover: item.cover || "",
      uri: item.uri || "",
      bvid: item.bvid || pa.bvid || "",
      aid: String(args.aid || pa.aid || item.param || ""),
      duration: item.cover_left_text_1 || "",
      // 时长（实测在 text_1，如 13:02）
      play: item.cover_left_text_2 || "",
      // 观看数（实测在 text_2，如 25.4万观看）
      danmaku: item.cover_left_text_3 || "",
      // 弹幕数（如 13弹幕）
      date: descDate(item.desc || ""),
      reason: item.bottom_rcmd_reason || ""
    };
  }
  async function fetchAppFeed(accessKey = "") {
    var _a;
    const idx = Math.floor(Date.now() / 1e3) + Math.floor(Math.random() * 1e3);
    const query = signAppQuery({
      build: "1",
      mobi_app: "iphone",
      device: "pad",
      idx: String(idx),
      access_key: accessKey
    });
    const url = `https://app.bilibili.com/x/v2/feed/index?${query}`;
    const text = await gmRequest({ method: "GET", url });
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { code: -1, message: "响应非 JSON（可能被风控/登录拦截）", cards: [], raw: text };
    }
    const items2 = Array.isArray((_a = json == null ? void 0 : json.data) == null ? void 0 : _a.items) ? json.data.items : [];
    const cards = items2.map(normalize).filter((c) => !!c && c.goto === "av");
    const code = typeof (json == null ? void 0 : json.code) === "number" ? json.code : -1;
    return { code, message: (json == null ? void 0 : json.message) || "", cards, raw: json };
  }
  const NS = "bk-feed";
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const coverUrl = (u) => u ? u.replace(/^http:/, "https:") : BLANK;
  function readSetting(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem("bilikit:settings") || "{}")[key];
      return v === void 0 ? fallback : v;
    } catch {
      return fallback;
    }
  }
  function injectStyle() {
    if (document.getElementById("bk-feed-style")) return;
    const s = document.createElement("style");
    s.id = "bk-feed-style";
    s.textContent = `
    .${NS}{ display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:22px 16px; padding:16px 0; }
    /* 不再用 content-visibility：真·窗口化已把 DOM 限制在可视附近；且 CV 会让「窗口内但不在视口」的卡
       塌回 contain-intrinsic-size，与视口内卡的真实高不一致 → 滚动时高度抖动。去掉后每卡真实等高。 */
    .${NS}-card{ cursor:pointer; transition:transform .18s ease; }
    .${NS}-card:hover{ transform:translateY(-4px); } /* 悬浮浮起（transform → 合成层，不触发重排） */
    .${NS}-cover{ position:relative; aspect-ratio:16/9; border-radius:8px; overflow:hidden; background:var(--bg2,#e3e5e7); transition:box-shadow .18s ease; }
    .${NS}-card:hover .${NS}-cover{ box-shadow:0 6px 20px rgba(0,0,0,.22); }
    .${NS}-cover img{ width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .35s ease; }
    .${NS}-cover.loaded img{ opacity:1; }
    /* hover 雪碧图预览：盖在封面上，鼠标横向刮帧；在遮罩(z-index:2)之下、图片之上 */
    .${NS}-preview{ position:absolute; inset:0; z-index:1; background-repeat:no-repeat; opacity:0; transition:opacity .15s ease; pointer-events:none; }
    .${NS}-preview.on{ opacity:1; }
    /* 预览进度条：底部细条，随播放推进（scaleX → 合成层）。z-index:3 压在遮罩之上，短视频也看得清进度 */
    .${NS}-pbar{ position:absolute; left:0; right:0; bottom:0; z-index:3; height:3px; background:rgba(0,0,0,.28); opacity:0; transition:opacity .15s ease; pointer-events:none; }
    .${NS}-pbar.on{ opacity:1; }
    .${NS}-pbar i{ display:block; width:100%; height:100%; background:var(--brand_blue,#00aeec); transform:scaleX(0); transform-origin:left; }
    /* 骨架微光：统一走「合成层友好的 transform 位移伪元素」——封面(未加载)、骨架条、头像同一套，
       只动 transform（GPU 合成，不逐帧重绘），滚动/加载期都不掉帧。封面 .loaded/.failed 后伪元素消失。 */
    .${NS}-shimmer{ position:relative; overflow:hidden; background-color:var(--bg2,#e3e5e7); }
    .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}-shimmer::after{
      content:''; position:absolute; inset:0;
      /* 浅色默认：白光打在浅灰底上看不见 → 用暗色扫光（浅底上才有对比） */
      background:linear-gradient(90deg, transparent 20%, rgba(0,0,0,.07) 50%, transparent 80%);
      transform:translateX(-100%); animation:bk-shimmer 1.6s linear infinite;
    }
    /* 深色：按页面真实底色判定(JS 给 grid 加 .bk-dark)，不用 @media prefers——避免「系统浅/B站深」时不生效。用淡白扫光 */
    .${NS}.bk-dark .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}.bk-dark .${NS}-shimmer::after{
      background:linear-gradient(90deg, transparent 15%, rgba(255,255,255,.11) 50%, transparent 85%);
    }
    @keyframes bk-shimmer{ to{ transform:translateX(100%); } }
    /* 封面底部遮罩：左「播放·弹幕」右「时长」 */
    /* z-index:1 必需：封面 img 有 opacity 过渡，Safari 会把它提升为合成层、盖住本遮罩；
       给遮罩显式 z-index 才能压在图片层之上（否则 z-index:auto 不进合成层，被图片遮住）。 */
    .${NS}-mask{ position:absolute; left:0; right:0; bottom:0; z-index:2; display:flex; align-items:flex-end; justify-content:space-between; padding:8px 8px 7px; color:#fff; font-size:12px; line-height:1; background:linear-gradient(transparent, rgba(0,0,0,.85)); pointer-events:none; }
    .${NS}-mstat{ display:flex; align-items:center; gap:9px; }
    .${NS}-mstat span{ display:inline-flex; align-items:center; gap:3px; }
    .${NS}-mstat svg{ width:15px; height:15px; }
    /* 下方：头像独占左栏，右栏上标题、下「UP名 · 日期」 */
    .${NS}-bottom{ display:flex; gap:10px; margin-top:9px; align-items:flex-start; }
    .${NS}-face{ width:34px; height:34px; flex:0 0 34px; border-radius:50%; object-fit:cover; background:var(--bg2,#e3e5e7); }
    img.${NS}-face{ cursor:pointer; transition:box-shadow .15s ease; } /* 有头像时可点进空间（占位 div 不给手型） */
    img.${NS}-face:hover{ box-shadow:0 0 0 2px var(--brand_blue,#00aeec); } /* hover 强调：品牌色圆环 */
    .${NS}-right{ flex:1; min-width:0; }
    .${NS}-up{ cursor:pointer; } /* UP 名可点进空间 */
    .${NS}-up:hover{ color:var(--brand_blue,#00aeec); }
    /* min-height 固定 2 行：让每张卡等高，虚拟化的行高估算才准、不漂移抖动（1 行标题也占 2 行位） */
    .${NS}-title{ margin:0 0 6px; font-size:15px; font-weight:500; line-height:1.4; min-height:2.8em; color:var(--text1,#18191c); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .${NS}-sub{ display:flex; align-items:center; font-size:13px; color:var(--text3,#9499a0); }
    .${NS}-who{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .${NS}-sub i{ margin:0 5px; font-style:normal; }
    /* 推荐理由行内 pill（学 Gate）：只描边+文字色、不填充；实际配色由 B 站 reason style 内联覆盖 */
    .${NS}-badge{ flex:none; margin-right:6px; padding:0 6px; border:1px solid var(--brand_blue,#00aeec); border-radius:6px; color:var(--brand_blue,#00aeec); background:transparent; font-size:11px; line-height:16px; }
    /* 骨架占位（数据未到时） */
    .${NS}-skline{ height:13px; border-radius:4px; margin-bottom:8px; }
    /* 未装 Core 的提示条（可关闭） */
    .${NS}-warn{ grid-column:1/-1; display:flex; align-items:center; gap:12px; margin-bottom:6px; padding:10px 14px; border-radius:10px; background:var(--bg2,#f1f2f3); color:var(--text2,#61666d); font-size:13px; }
    .${NS}-warn b{ color:var(--text1,#18191c); }
    .${NS}-warn a{ color:var(--brand_blue,#00aeec); text-decoration:none; white-space:nowrap; }
    .${NS}-warn .bk-x{ margin-left:auto; border:0; background:transparent; color:var(--text3,#9499a0); cursor:pointer; font-size:14px; line-height:1; padding:4px; }
    .${NS}-warn .bk-x:hover{ color:var(--text1,#18191c); }
    .${NS}-spacer{ grid-column:1/-1; height:0; }  /* 窗口化：上下占位行，撑起未渲染区的高度，保滚动位置 */
    .${NS}-sentinel{ grid-column:1/-1; height:1px; }
    .${NS}-tip{ grid-column:1/-1; text-align:center; color:var(--text3,#9499a0); font-size:13px; padding:20px; }
    .${NS}-fab{ position:fixed; right:24px; bottom:32px; z-index:1000; display:flex; flex-direction:column; gap:10px; }
    /* 统一图标按钮：圆形 + 细描边 + 表面底 + 轻阴影，hover 变品牌色微浮起、按下微缩。悬浮按钮与抽屉浮动按钮共用 */
    .${NS}-fab button, .${NS}-dctrls button{
      width:40px; height:40px; border-radius:50%; padding:0;
      display:flex; align-items:center; justify-content:center;
      border:1px solid var(--line_regular,#e3e5e7); background:var(--bg1,#fff); color:var(--text2,#61666d);
      cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,.12);
      transition:color .16s ease, transform .16s ease, box-shadow .16s ease, opacity .18s ease;
    }
    .${NS}-fab button:hover, .${NS}-dctrls button:hover{ color:var(--brand_blue,#00aeec); transform:translateY(-2px); box-shadow:0 5px 16px rgba(0,0,0,.2); }
    .${NS}-fab button:active, .${NS}-dctrls button:active{ transform:scale(.94); }
    .${NS}-fab .bk-top{ opacity:0; pointer-events:none; transform:scale(.85); }      /* 默认藏，滚动后现 */
    .${NS}-fab.scrolled .bk-top{ opacity:1; pointer-events:auto; transform:none; }
    .${NS}-fab button.busy{ pointer-events:none; }
    .${NS}-fab button.busy svg{ animation:bk-spin .8s linear infinite; }
    @keyframes bk-spin{ to{ transform:rotate(360deg); } }
    /* 底部上滑抽屉：顶部留 64px 缝(显遮罩、点击关闭)；关闭/新标签是缝里的独立浮动按钮 */
    .${NS}-dmask{ position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .3s ease; }
    .${NS}-dmask.on{ opacity:1; pointer-events:auto; } /* 关闭后 pointer-events:none，否则透明遮罩仍拦全站点击 */
    .${NS}-drawer{ position:fixed; left:0; right:0; bottom:0; height:calc(100% - 64px); z-index:100001; display:flex; flex-direction:column; background:var(--bg1,#fff); border-radius:14px 14px 0 0; box-shadow:0 -8px 40px rgba(0,0,0,.35); transform:translateY(100%); transition:transform .32s cubic-bezier(.32,.72,0,1); overflow:hidden; }
    .${NS}-drawer.on{ transform:translateY(0); }
    .${NS}-dframe{ flex:1; width:100%; border:0; display:block; }
    /* 下拉提示气泡（顶部缝里居中，拖拽时淡入） */
    .${NS}-dhint{ position:fixed; top:19px; left:50%; transform:translateX(-50%); z-index:100002; font-size:12px; color:#fff; background:rgba(0,0,0,.55); padding:3px 12px; border-radius:12px; opacity:0; pointer-events:none; transition:opacity .15s ease; -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); }
    .${NS}-dhint.on{ opacity:1; }
    /* 加载遮罩：封面模糊铺底 + spinner，盖住打开瞬间黑→白闪 */
    .${NS}-dload{ position:absolute; inset:0; z-index:1; display:flex; align-items:center; justify-content:center; background:#18191c; opacity:0; pointer-events:none; transition:opacity .3s ease; }
    .${NS}-drawer.loading .${NS}-dload{ opacity:1; }
    .${NS}-dload-cover{ position:absolute; inset:0; background-size:cover; background-position:center; filter:blur(24px) brightness(.6); transform:scale(1.1); }
    .${NS}-dspin{ position:relative; width:42px; height:42px; border:3px solid rgba(255,255,255,.2); border-top-color:var(--brand_blue,#00aeec); border-radius:50%; animation:bk-spin .8s linear infinite; }
    @media (prefers-color-scheme: light){ .${NS}-dload{ background:#f4f4f5; } .${NS}-dspin{ border-color:rgba(0,0,0,.12); border-top-color:var(--brand_blue,#00aeec); } }
    /* 顶部缝里的独立浮动按钮 */
    .${NS}-dctrls{ position:fixed; top:14px; right:18px; z-index:100002; display:flex; gap:10px; opacity:0; pointer-events:none; transition:opacity .3s ease; }
    .${NS}-dctrls.on{ opacity:1; pointer-events:auto; } /* 按钮样式与 .bk-feed-fab button 共用（统一） */
  `;
    (document.head || document.documentElement).appendChild(s);
  }
  function hideNativeChrome() {
    if (document.getElementById("bk-feed-chrome")) return;
    const s = document.createElement("style");
    s.id = "bk-feed-chrome";
    s.textContent = `
    .feed-roll-btn { display: none !important; }        /* 右侧「换一换」 */
    .palette-button-wrap { display: none !important; }   /* 右下角 刷新内容/更多/返回顶部 */
    .adblock-tips { display: none !important; }          /* 顶部「检测到浏览器插件…加入白名单」提示 */
    /* 分区栏「不钉顶」：.header-channel 是 B 站在滚动后注入的钉顶副本（首屏时 h=0、空），
       真正可见的分区在 .bili-header 内、会随页滚走。隐掉这个副本即可：分区仍在（顶部那份），
       只是不再钉顶，也避开了它注入高度时引发的画面抽搐。 */
    .header-channel { display: none !important; }
  `;
    (document.head || document.documentElement).appendChild(s);
  }
  const shotCache = /* @__PURE__ */ new Map();
  const imgLoaded = /* @__PURE__ */ new Set();
  function preloadImg(src) {
    if (!src || imgLoaded.has(src)) return Promise.resolve();
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = im.onerror = () => {
        imgLoaded.add(src);
        if (imgLoaded.size > 400) imgLoaded.delete(imgLoaded.values().next().value);
        resolve();
      };
      im.src = src;
    });
  }
  async function fetchVideoshot(bvid) {
    var _a;
    if (shotCache.has(bvid)) return shotCache.get(bvid);
    let shot = null;
    try {
      const text = await gmRequest({ method: "GET", url: `https://api.bilibili.com/x/player/videoshot?bvid=${bvid}&index=1` });
      const d = (_a = JSON.parse(text)) == null ? void 0 : _a.data;
      if (d && Array.isArray(d.image) && d.image.length && Array.isArray(d.index) && d.index.length) {
        shot = { images: d.image.map((u) => coverUrl(u)), index: d.index, xlen: d.img_x_len || 10, ylen: d.img_y_len || 10 };
      }
    } catch {
    }
    shotCache.set(bvid, shot);
    if (shotCache.size > 200) shotCache.delete(shotCache.keys().next().value);
    return shot;
  }
  function setupHoverPreview(cover, bvid) {
    const RUN = 8e3;
    const FRAME_MS = 250;
    let hovering = false;
    let enterTimer = null;
    let rafId = 0;
    let startT = 0;
    let lastFrameAt = 0;
    let lastIdx = -1;
    let preview = null;
    let pbar = null;
    let bar = null;
    let shot = null;
    const showFrame = (idx) => {
      if (!preview || !shot) return;
      const per = shot.xlen * shot.ylen;
      const sheet = Math.min(Math.floor(idx / per), shot.images.length - 1);
      const local = idx % per;
      const col = local % shot.xlen;
      const row = Math.floor(local / shot.xlen);
      preview.style.backgroundImage = `url("${shot.images[sheet]}")`;
      preview.style.backgroundSize = `${shot.xlen * 100}% ${shot.ylen * 100}%`;
      preview.style.backgroundPosition = `${shot.xlen > 1 ? col / (shot.xlen - 1) * 100 : 0}% ${shot.ylen > 1 ? row / (shot.ylen - 1) * 100 : 0}%`;
    };
    const tick = (now) => {
      if (!cover.isConnected) {
        stop();
        return;
      }
      if (!hovering || !shot) {
        rafId = 0;
        return;
      }
      const p = (now - startT) % RUN / RUN;
      if (bar) bar.style.transform = `scaleX(${p})`;
      if (now - lastFrameAt >= FRAME_MS) {
        lastFrameAt = now;
        const idx = Math.min(Math.floor(p * shot.index.length), shot.index.length - 1);
        if (idx !== lastIdx) {
          lastIdx = idx;
          showFrame(idx);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    const stop = () => {
      hovering = false;
      if (enterTimer) {
        clearTimeout(enterTimer);
        enterTimer = null;
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      preview == null ? void 0 : preview.classList.remove("on");
      pbar == null ? void 0 : pbar.classList.remove("on");
    };
    cover.addEventListener("mouseenter", () => {
      if (hovering) return;
      hovering = true;
      enterTimer = setTimeout(async () => {
        enterTimer = null;
        const s = await fetchVideoshot(bvid);
        if (!s || !hovering) return;
        await preloadImg(s.images[0]);
        if (!hovering) return;
        shot = s;
        if (!preview) {
          preview = document.createElement("div");
          preview.className = `${NS}-preview`;
          cover.appendChild(preview);
          pbar = document.createElement("div");
          pbar.className = `${NS}-pbar`;
          bar = document.createElement("i");
          pbar.appendChild(bar);
          cover.appendChild(pbar);
        }
        lastIdx = -1;
        lastFrameAt = 0;
        startT = performance.now();
        showFrame(0);
        preview.classList.add("on");
        pbar.classList.add("on");
        rafId = requestAnimationFrame(tick);
        for (const src of s.images.slice(1)) void preloadImg(src);
      }, 150);
    });
    cover.addEventListener("mouseleave", stop);
  }
  const NEWTAB_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const MARK = "#bk-drawer";
  let mask = null;
  let panel = null;
  let frame = null;
  let ctrls = null;
  let loadCover = null;
  let dhint = null;
  let closeTimer = null;
  let loadTimer = null;
  let curUrl = "";
  const GESTURE_GAP = 200;
  const DEAD = 20;
  const DAMP = 0.5;
  const PULL_CLOSE = 90;
  let raw = 0;
  let pull = 0;
  let lastWheelAt = 0;
  let armed = false;
  let wheelTimer = null;
  function frameWin() {
    try {
      return (frame == null ? void 0 : frame.contentWindow) || null;
    } catch {
      return null;
    }
  }
  function snapBack() {
    raw = 0;
    pull = 0;
    if (wheelTimer) {
      clearTimeout(wheelTimer);
      wheelTimer = null;
    }
    if (panel) {
      panel.style.transition = "";
      panel.style.transform = "";
    }
    dhint == null ? void 0 : dhint.classList.remove("on");
  }
  function onWheel(e) {
    if (!panel || !dhint || !panel.classList.contains("on")) return;
    const now = performance.now();
    const w = frameWin();
    const atTop = w ? (w.scrollY || 0) <= 0 : true;
    if (now - lastWheelAt > GESTURE_GAP) armed = atTop;
    lastWheelAt = now;
    if (!armed || !atTop || e.deltaY >= 0) {
      if (raw > 0) snapBack();
      return;
    }
    raw += -e.deltaY;
    pull = Math.max(0, raw - DEAD) * DAMP;
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      if (pull > PULL_CLOSE) closeDrawer();
      else snapBack();
    }, 180);
    if (pull <= 0) return;
    panel.style.transition = "none";
    panel.style.transform = `translateY(${Math.min(pull, 340)}px)`;
    const willClose = pull > PULL_CLOSE;
    dhint.classList.add("on");
    dhint.textContent = willClose ? "松开关闭" : "下拉关闭";
  }
  function setLoading(on) {
    panel == null ? void 0 : panel.classList.toggle("loading", on);
    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
    if (on) loadTimer = setTimeout(() => setLoading(false), 6e3);
  }
  function ensureDom() {
    if (mask) return;
    mask = document.createElement("div");
    mask.className = `${NS}-dmask`;
    panel = document.createElement("div");
    panel.className = `${NS}-drawer`;
    frame = document.createElement("iframe");
    frame.className = `${NS}-dframe`;
    frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write";
    frame.allowFullscreen = true;
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals allow-downloads");
    frame.addEventListener("load", () => {
      var _a;
      setLoading(false);
      try {
        (_a = frame.contentWindow) == null ? void 0 : _a.addEventListener("wheel", onWheel, { passive: true });
      } catch {
      }
    });
    panel.appendChild(frame);
    const load = document.createElement("div");
    load.className = `${NS}-dload`;
    loadCover = document.createElement("div");
    loadCover.className = `${NS}-dload-cover`;
    const spinner = document.createElement("div");
    spinner.className = `${NS}-dspin`;
    load.append(loadCover, spinner);
    panel.appendChild(load);
    ctrls = document.createElement("div");
    ctrls.className = `${NS}-dctrls`;
    ctrls.innerHTML = `<button class="bk-newtab" title="在新标签页打开" aria-label="在新标签页打开">${NEWTAB_SVG}</button><button class="bk-close" title="关闭" aria-label="关闭">${CLOSE_SVG}</button>`;
    ctrls.querySelector(".bk-newtab").addEventListener("click", () => {
      if (curUrl) window.open(curUrl, "_blank", "noopener");
      closeDrawer();
    });
    ctrls.querySelector(".bk-close").addEventListener("click", closeDrawer);
    dhint = document.createElement("div");
    dhint.className = `${NS}-dhint`;
    dhint.textContent = "下拉关闭";
    mask.addEventListener("click", closeDrawer);
    mask.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && (panel == null ? void 0 : panel.classList.contains("on"))) closeDrawer();
    });
    document.body.append(mask, panel, ctrls, dhint);
  }
  function openDrawer(url, cover = "") {
    ensureDom();
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    curUrl = url;
    if (loadCover) loadCover.style.backgroundImage = cover ? `url("${cover}")` : "";
    setLoading(true);
    const marked = url.includes("#") ? url : url + MARK;
    if (frame.src !== marked) frame.src = marked;
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => {
      mask.classList.add("on");
      panel.classList.add("on");
      ctrls.classList.add("on");
    });
  }
  function closeDrawer() {
    if (!panel || !mask || !ctrls) return;
    raw = 0;
    pull = 0;
    if (wheelTimer) {
      clearTimeout(wheelTimer);
      wheelTimer = null;
    }
    panel.style.transition = "";
    panel.style.transform = "";
    dhint == null ? void 0 : dhint.classList.remove("on");
    mask.classList.remove("on");
    panel.classList.remove("on");
    ctrls.classList.remove("on");
    setLoading(false);
    document.documentElement.style.overflow = "";
    closeTimer = setTimeout(() => {
      if (frame && !(panel == null ? void 0 : panel.classList.contains("on"))) frame.src = "about:blank";
    }, 340);
  }
  const PC_HOSTS = ["https://api.bilibili.com", "https://s1.hdslb.com", "https://i0.hdslb.com", "https://i1.hdslb.com", "https://i2.hdslb.com", "https://data.bilibili.com"];
  const PC_WINDOW = 12e3;
  let lastPc = -Infinity;
  let pcLinks = [];
  function preconnect() {
    const now = performance.now();
    if (now - lastPc < PC_WINDOW) return;
    lastPc = now;
    pcLinks.forEach((l) => l.remove());
    pcLinks = PC_HOSTS.map((href) => {
      const l = document.createElement("link");
      l.rel = "preconnect";
      l.href = href;
      document.head.appendChild(l);
      return l;
    });
  }
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const DM_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 16H9l-5 4V5.5A1.5 1.5 0 0 1 5.5 4z"/></svg>';
  const stripUnit = (s) => s.replace(/观看|播放|弹幕|次/g, "").trim();
  function makeCard(c) {
    const el = document.createElement("div");
    el.className = `${NS}-card`;
    const mstat = (c.play ? `<span>${PLAY_SVG}${esc(stripUnit(c.play))}</span>` : "") + (c.danmaku ? `<span>${DM_SVG}${esc(stripUnit(c.danmaku))}</span>` : "");
    const badge = c.reason ? `<span class="${NS}-badge">${esc(c.reason)}</span>` : "";
    const who = `<span class="${NS}-up">${esc(c.up)}</span>` + (c.date ? `<i>·</i>${esc(c.date)}` : "");
    const sub = badge + `<span class="${NS}-who">${who}</span>`;
    el.innerHTML = `<div class="${NS}-cover"><img alt="" data-src="${esc(coverUrl(c.cover))}"><div class="${NS}-mask"><div class="${NS}-mstat">${mstat}</div>` + (c.duration ? `<span>${esc(c.duration)}</span>` : "<span></span>") + `</div></div><div class="${NS}-bottom">` + (c.face ? `<img class="${NS}-face" src="${esc(coverUrl(c.face))}" alt="" loading="lazy">` : `<div class="${NS}-face"></div>`) + `<div class="${NS}-right"><div class="${NS}-title">${esc(c.title)}</div><div class="${NS}-sub">${sub}</div></div></div>`;
    const coverEl = el.querySelector(`.${NS}-cover`);
    const imgEl = el.querySelector("img");
    imgEl.addEventListener("load", () => {
      coverEl.classList.toggle("loaded", !imgEl.src.startsWith("data:"));
    });
    imgEl.addEventListener("error", () => {
      if (!imgEl.src.startsWith("data:")) coverEl.classList.add("failed");
    });
    if (c.bvid) setupHoverPreview(coverEl, c.bvid);
    el.addEventListener("mouseenter", preconnect);
    el.addEventListener("click", (e) => {
      if (c.mid && e.target.closest(`.${NS}-face, .${NS}-up`)) {
        window.open(`https://space.bilibili.com/${c.mid}`, "_blank", "noopener");
        return;
      }
      const url = c.bvid ? `https://www.bilibili.com/video/${c.bvid}` : c.uri;
      if (!url || !/^https?:\/\//i.test(url)) return;
      const mode = readSetting("feed.openMode", "drawer");
      if (mode === "current") location.href = url;
      else if (mode === "drawer" && c.bvid) openDrawer(url, coverUrl(c.cover));
      else window.open(url, "_blank", "noopener");
    });
    return el;
  }
  function makeSkeleton() {
    const el = document.createElement("div");
    el.className = `${NS}-card ${NS}-skcard`;
    el.innerHTML = `<div class="${NS}-cover"></div><div class="${NS}-bottom"><div class="${NS}-face ${NS}-shimmer"></div><div class="${NS}-right"><div class="${NS}-shimmer ${NS}-skline"></div><div class="${NS}-shimmer ${NS}-skline" style="width:70%"></div><div class="${NS}-shimmer ${NS}-skline" style="width:45%;margin-top:6px"></div></div></div>`;
    return el;
  }
  let controls = null;
  let markerEl = null;
  let markerIo = null;
  function mountControls(onRefresh) {
    if (controls && controls.isConnected) return;
    controls == null ? void 0 : controls.remove();
    markerEl == null ? void 0 : markerEl.remove();
    markerIo == null ? void 0 : markerIo.disconnect();
    const REFRESH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
    const TOP_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    const fab = document.createElement("div");
    fab.className = `${NS}-fab`;
    fab.innerHTML = `<button class="bk-top" title="返回顶部" aria-label="返回顶部">${TOP_SVG}</button><button class="bk-refresh" title="刷新内容" aria-label="刷新内容">${REFRESH_SVG}</button>`;
    const refreshBtn = fab.querySelector(".bk-refresh");
    refreshBtn.addEventListener("click", () => onRefresh(refreshBtn));
    fab.querySelector(".bk-top").addEventListener(
      "click",
      () => window.scrollTo({ top: 0, behavior: "smooth" })
    );
    document.body.appendChild(fab);
    controls = fab;
    const marker = document.createElement("div");
    marker.style.cssText = "position:absolute;top:400px;left:0;width:1px;height:1px;pointer-events:none;";
    document.body.appendChild(marker);
    markerEl = marker;
    markerIo = new IntersectionObserver((es) => fab.classList.toggle("scrolled", !es[0].isIntersecting));
    markerIo.observe(marker);
  }
  const seen = /* @__PURE__ */ new Set();
  let grid = null;
  let sentinel = null;
  let topSpacer = null;
  let bottomSpacer = null;
  let loading = false;
  let exhausted = false;
  let cardIo = null;
  let sentinelIo = null;
  let feedGen = 0;
  const items = [];
  const nodes = /* @__PURE__ */ new Map();
  let cachedCols = 1;
  let renderRaf = 0;
  let suppressScroll = false;
  let cooldownUntil = 0;
  function getAccessKey() {
    try {
      return JSON.parse(localStorage.getItem("bilikit:settings") || "{}")["feed.accessKey"] || "";
    } catch {
      return "";
    }
  }
  let darkProbe = null;
  function pageIsDark() {
    if (!darkProbe) {
      darkProbe = document.createElement("div");
      darkProbe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;background:var(--bg2,#fff);pointer-events:none";
      (document.body || document.documentElement).appendChild(darkProbe);
    }
    const m = getComputedStyle(darkProbe).backgroundColor.match(/\d+(?:\.\d+)?/g);
    if (!m) return false;
    return 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2] < 128;
  }
  function metrics() {
    const cs = getComputedStyle(grid);
    const parts = cs.gridTemplateColumns.split(" ").filter(Boolean);
    const cols = parts.length && parts.every((p) => p.endsWith("px")) ? parts.length : cachedCols;
    cachedCols = cols;
    let cardH = 330;
    const first = nodes.size ? nodes.values().next().value : null;
    if (first && first.offsetHeight > 50) cardH = first.offsetHeight;
    const rowGap = parseFloat(cs.rowGap) || 22;
    return { cols, rowH: cardH + rowGap };
  }
  function render() {
    if (!grid || !sentinel || !topSpacer || !bottomSpacer) return;
    if (!items.length) {
      topSpacer.style.height = "0px";
      bottomSpacer.style.height = "0px";
      return;
    }
    const { cols, rowH } = metrics();
    const totalRows = Math.ceil(items.length / cols);
    const gridTop = grid.getBoundingClientRect().top + window.scrollY;
    const into = window.scrollY - gridTop;
    const vh = window.innerHeight;
    const BUF = vh * 1.5;
    const firstRow = Math.max(0, Math.floor((into - BUF) / rowH));
    const lastRow = Math.min(totalRows - 1, Math.max(0, Math.ceil((into + vh + BUF) / rowH)));
    const startIdx = firstRow * cols;
    const endIdx = Math.min(items.length, (lastRow + 1) * cols);
    const anchor = firstRow > 0 ? nodes.get(Math.max(0, Math.floor(into / rowH)) * cols) || null : null;
    const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    for (const [i, el] of nodes) {
      if (i < startIdx || i >= endIdx) {
        cardIo == null ? void 0 : cardIo.unobserve(el);
        el.remove();
        nodes.delete(i);
      }
    }
    topSpacer.style.height = firstRow * rowH + "px";
    bottomSpacer.style.height = Math.max(0, (totalRows - (lastRow + 1)) * rowH) + "px";
    for (let i = startIdx; i < endIdx; i++) {
      if (nodes.has(i)) continue;
      const el = makeCard(items[i]);
      nodes.set(i, el);
      let ref = bottomSpacer;
      for (let j = i + 1; j < endIdx; j++) {
        const n = nodes.get(j);
        if (n) {
          ref = n;
          break;
        }
      }
      grid.insertBefore(el, ref);
      cardIo == null ? void 0 : cardIo.observe(el);
    }
    if (anchor) {
      const delta = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(delta) > 0.5) {
        suppressScroll = true;
        window.scrollBy(0, delta);
      }
    }
  }
  function scheduleRender() {
    if (suppressScroll) {
      suppressScroll = false;
      return;
    }
    if (renderRaf) return;
    renderRaf = requestAnimationFrame(() => {
      renderRaf = 0;
      render();
    });
  }
  function clearAll() {
    if (cardIo) cardIo.disconnect();
    for (const el of nodes.values()) el.remove();
    nodes.clear();
    items.length = 0;
    if (topSpacer) topSpacer.style.height = "0px";
    if (bottomSpacer) bottomSpacer.style.height = "0px";
  }
  function renderSkeletons(n) {
    if (!grid || !bottomSpacer) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) frag.appendChild(makeSkeleton());
    grid.insertBefore(frag, bottomSpacer);
  }
  function clearSkeletons() {
    if (grid) grid.querySelectorAll(`.${NS}-skcard`).forEach((n) => n.remove());
  }
  function sentinelInView() {
    if (!sentinel) return false;
    return sentinel.getBoundingClientRect().top < window.innerHeight + Math.max(window.innerHeight, 1200);
  }
  function showTip(text) {
    if (!grid) return;
    let tip = grid.querySelector(`.${NS}-tip`);
    if (!tip) {
      tip = document.createElement("div");
      tip.className = `${NS}-tip`;
      grid.appendChild(tip);
    }
    tip.textContent = text;
  }
  function removeTip() {
    var _a;
    (_a = grid == null ? void 0 : grid.querySelector(`.${NS}-tip`)) == null ? void 0 : _a.remove();
  }
  function hasRealCard() {
    return !!grid && !!grid.querySelector(`.${NS}-card:not(.${NS}-skcard)`);
  }
  async function loadMore() {
    if (loading || exhausted || !grid || !sentinel) return;
    if (performance.now() < cooldownUntil) return;
    loading = true;
    const gen = feedGen;
    let failed = false;
    try {
      let emptyStreak = 0;
      let first = true;
      while ((first || sentinelInView()) && emptyStreak < 3) {
        first = false;
        const { code, message, cards } = await fetchAppFeed(getAccessKey());
        if (gen !== feedGen) return;
        if (code !== 0) {
          console.warn(`[BiliKit Feed] 加载失败 code=${code} ${message}`);
          failed = true;
          break;
        }
        clearSkeletons();
        removeTip();
        let addedThisPage = 0;
        for (const c of cards) {
          if (!c.bvid || seen.has(c.bvid)) continue;
          seen.add(c.bvid);
          if (seen.size > 2e3) seen.delete(seen.values().next().value);
          items.push(c);
          addedThisPage++;
        }
        if (addedThisPage) render();
        emptyStreak = addedThisPage === 0 ? emptyStreak + 1 : 0;
      }
      if (emptyStreak >= 3) {
        if (getAccessKey()) {
          cooldownUntil = performance.now() + 3e3;
        } else {
          exhausted = true;
          showTip("匿名推荐已刷完（B 站给匿名请求的是固定内容池）。配置 access_key 可看个性化、不重复的推荐。");
        }
      }
    } catch (e) {
      console.error("[BiliKit Feed] 加载出错：", e);
      failed = true;
    } finally {
      if (gen === feedGen) {
        clearSkeletons();
        loading = false;
        if (failed) cooldownUntil = performance.now() + 3e3;
      }
    }
    if (gen === feedGen && failed && !hasRealCard()) showTip("加载失败，请稍后重试；若持续失败可在设置里配置 access_key 或检查网络。");
  }
  function refreshFeed(btn) {
    if (!grid || !sentinel) return;
    feedGen++;
    loading = false;
    clearAll();
    removeTip();
    seen.clear();
    exhausted = false;
    cooldownUntil = 0;
    renderSkeletons(12);
    if (btn) {
      btn.classList.add("busy");
      void loadMore().finally(() => btn.classList.remove("busy"));
    } else {
      void loadMore();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function findNativeFeed() {
    const card = document.querySelector(".feed-card, .bili-video-card");
    const byCard = card && card.closest(".container");
    if (byCard) return byCard;
    return [...document.querySelectorAll(".container")].find((c) => c.querySelector(".feed-card, .bili-video-card")) || null;
  }
  function takeover() {
    if (grid && grid.isConnected) return true;
    const native = findNativeFeed();
    if (!native || !native.parentElement) return false;
    if (cardIo) cardIo.disconnect();
    if (sentinelIo) sentinelIo.disconnect();
    document.querySelectorAll(`.${NS}`).forEach((g) => g.remove());
    feedGen++;
    loading = false;
    nodes.clear();
    items.length = 0;
    seen.clear();
    exhausted = false;
    cooldownUntil = 0;
    injectStyle();
    native.style.setProperty("display", "none", "important");
    cardIo = new IntersectionObserver(
      (ents) => {
        var _a;
        for (const e of ents) {
          const card = e.target;
          const img = card.querySelector("img");
          if (e.isIntersecting) {
            if (img && (!img.getAttribute("src") || img.src.startsWith("data:")) && img.dataset.src) {
              (_a = img.parentElement) == null ? void 0 : _a.classList.remove("failed");
              img.src = img.dataset.src;
            }
          } else {
            if (img && img.src && !img.src.startsWith("data:")) img.src = BLANK;
          }
        }
      },
      { rootMargin: "1000px 0px" }
    );
    grid = document.createElement("div");
    grid.className = NS;
    grid.classList.toggle("bk-dark", pageIsDark());
    topSpacer = document.createElement("div");
    topSpacer.className = `${NS}-spacer`;
    bottomSpacer = document.createElement("div");
    bottomSpacer.className = `${NS}-spacer`;
    sentinel = document.createElement("div");
    sentinel.className = `${NS}-sentinel`;
    grid.append(topSpacer, bottomSpacer, sentinel);
    native.parentElement.insertBefore(grid, native);
    sentinelIo = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "1000px 0px" });
    sentinelIo.observe(sentinel);
    mountControls((btn) => refreshFeed(btn));
    renderSkeletons(12);
    loadMore();
    return true;
  }
  const REPO = "https://github.com/shiinayane/BiliKit";
  function warnCoreMissing() {
    if (!grid || !topSpacer) return;
    if (localStorage.getItem("bilikit:dismiss.core-missing") || grid.querySelector(`.${NS}-warn`)) return;
    const bar = document.createElement("div");
    bar.className = `${NS}-warn`;
    bar.innerHTML = `<span>未检测到 <b>BiliKit Core</b>：登录、设置、抽屉净化都需要它。</span><a href="${REPO}" target="_blank" rel="noopener">前往安装</a><button class="bk-x" aria-label="关闭">✕</button>`;
    bar.querySelector(".bk-x").addEventListener("click", () => {
      try {
        localStorage.setItem("bilikit:dismiss.core-missing", "1");
      } catch {
      }
      bar.remove();
    });
    grid.insertBefore(bar, topSpacer);
  }
  function checkCore() {
    const alive = Number(localStorage.getItem("bilikit:alive.core") || 0);
    if (Date.now() - alive > 15e3) warnCoreMissing();
  }
  function mountFeed() {
    if (window.top !== window.self) return;
    try {
      localStorage.setItem("bilikit:alive.feed", String(Date.now()));
    } catch {
    }
    window.addEventListener("scroll", scheduleRender, { passive: true });
    window.addEventListener("resize", scheduleRender);
    const onHome = () => location.pathname === "/" || location.pathname === "/index.html";
    const tick = () => {
      if (onHome()) {
        hideNativeChrome();
        takeover();
      }
    };
    tick();
    setTimeout(() => {
      if (onHome()) checkCore();
    }, 2500);
    let tries = 0;
    const t = setInterval(() => {
      if (!onHome()) return;
      try {
        localStorage.setItem("bilikit:alive.feed", String(Date.now()));
      } catch {
      }
      hideNativeChrome();
      if (takeover()) ;
      if (grid) grid.classList.toggle("bk-dark", pageIsDark());
      if (++tries > 600) clearInterval(t);
    }, 1e3);
  }
  mountFeed();

})();