// ==UserScript==
// @name         BiliKit · CDN 优选
// @name:en      BiliKit · CDN Pick
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.1.0
// @description    把 B 站视频分片重定向到指定 CDN 镜像，绕开被分到的慢节点（海外 Akamai 等）。Safari 友好：页面世界注入、不依赖 GM/unsafeWindow，故能拦到播放器真正的请求（CCB 等脚本在 Safari Userscripts 下因 grant 被注入隔离世界而失效）。
// @description:en Redirect Bilibili video segments to a chosen CDN mirror, bypassing the slow node you were assigned (e.g. overseas Akamai). Safari-friendly: page-world injection without GM/unsafeWindow.
// @author       shiinayane
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * 原理：B 站把可用清晰度/编码的「带签名的分片地址」放在 playurl 响应里
 * （首帧在 window.__playinfo__，换片/切档时走 /x/player/wbi/playurl 等接口）。
 * 同一条视频通常同时给出多个 CDN 的地址：bilivideo.com 系（upos 签名，签名
 * 只认 uparams、与主机名无关，故可在各镜像间互换）与 akamaized.net（Akamai
 * 自己的 hdnts 签名，换主机即失效）。
 *
 * 本脚本只做一件事：在 playurl 里挑出那条 upos 签名的 bilivideo 地址，把它的
 * 主机换成你指定的镜像（TARGET_HOST），并顶到 baseUrl 首选——播放器于是从你
 * 选的节点取流。绝不把 akam 的 hdnts 地址套到 bilivideo 主机上（那样会 403）。
 *
 * 为什么不在分片(.m4s)请求层换主机：那些地址带 host 相关的签名，裸换主机会
 * 401/403；只有在 playurl 层换 upos 系地址才安全。
 */
(() => {
  'use strict'

  if (window.top !== window.self) return
  if (window.__BILIKIT_CDN_PICK__) return
  window.__BILIKIT_CDN_PICK__ = true

  /* ------------------------------------------------------------------ *
   * 配置
   * ------------------------------------------------------------------ */
  // 想换的镜像主机（裸域名）。换节点就改这一行、刷新即可。常用候选：
  //   upos-sz-mirroralib.bilivideo.com   阿里大陆（回源快，冷门/新内容友好）
  //   upos-sz-mirrorcosov.bilivideo.com  腾讯海外（你 HAR 实测 56Mbps 的快节点）
  //   upos-sz-mirrorhw.bilivideo.com     华为   /  upos-sz-mirroraliov.bilivideo.com  阿里海外
  // 置空字符串 '' = 关闭本脚本（不改写）。
  const TARGET_HOST = 'upos-sz-mirroralib.bilivideo.com'

  const DEBUG = true // 调试期开着看改写日志；定稿后改 false
  const log = (...a) => { if (DEBUG) console.log('[CDN优选]', ...a) }

  if (!TARGET_HOST) { log('TARGET_HOST 为空，未启用'); return }

  // upos 系（签名与主机无关，可安全换镜像）；akamaized 不在此列，绝不往上套
  const isUpos = (u) => typeof u === 'string' && /(?:\.bilivideo\.com|\.acgvideo\.(?:com|cn))\//.test(u + '/')
  const swapHost = (u) => u.replace(/^(?:https?:)?\/\/[^/]+\//, `https://${TARGET_HOST}/`)

  let rewriteCount = 0

  // 把一条 dash 流（或 durl 段）的 baseUrl 顶成「目标镜像 + upos 签名」
  function fixEntry(e) {
    if (!e || typeof e !== 'object') return false
    const cands = []
    for (const k of ['baseUrl', 'base_url', 'url']) if (typeof e[k] === 'string') cands.push(e[k])
    for (const k of ['backupUrl', 'backup_url']) if (Array.isArray(e[k])) cands.push(...e[k].filter((x) => typeof x === 'string'))
    const upos = cands.find(isUpos)
    if (!upos) return false // 只有 akam、没有 upos 备选 → 不动（换主机会 403）
    const target = swapHost(upos)
    for (const k of ['baseUrl', 'base_url', 'url']) if (typeof e[k] === 'string') e[k] = target
    // 备选里的 upos 地址也一并换到目标镜像，保留 akam 作为最后兜底
    for (const k of ['backupUrl', 'backup_url']) {
      if (Array.isArray(e[k])) e[k] = e[k].map((u) => (isUpos(u) ? swapHost(u) : u))
    }
    rewriteCount++
    return true
  }

  // 改写整个 playurl 对象（兼容网页 data / 番剧 result 两种外层）
  function rewritePlayurl(root) {
    if (!root || typeof root !== 'object') return false
    if (root.code !== undefined && root.code !== 0) return false
    const d = root.data || root.result || root
    if (!d || typeof d !== 'object') return false
    let hit = false
    const dash = d.dash
    if (dash) {
      for (const list of [dash.video, dash.audio, dash.dolby && dash.dolby.audio]) {
        if (Array.isArray(list)) list.forEach((e) => { if (fixEntry(e)) hit = true })
      }
      if (dash.flac && dash.flac.audio && fixEntry(dash.flac.audio)) hit = true
    }
    if (Array.isArray(d.durl)) d.durl.forEach((e) => { if (fixEntry(e)) hit = true }) // 非 dash 的 mp4
    return hit
  }

  const PLAYURL_PATHS = [
    '/x/player/wbi/playurl', '/x/player/playurl',
    '/pgc/player/web/playurl', '/pgc/player/web/v2/playurl', '/pgc/player/api/playurl',
    '/pugv/player/web/playurl',
  ]
  const isPlayurl = (u) => typeof u === 'string' && PLAYURL_PATHS.some((p) => u.includes(p))

  /* ------------------------------------------------------------------ *
   * 一、首帧：window.__playinfo__（服务端内联，早于任何接口）
   * ------------------------------------------------------------------ */
  let playinfo
  try {
    Object.defineProperty(window, '__playinfo__', {
      configurable: true,
      get: () => playinfo,
      set: (v) => {
        try { if (rewritePlayurl(v)) log('__playinfo__ 改写', TARGET_HOST) } catch (_) {}
        playinfo = v
      },
    })
  } catch (_) {}

  /* ------------------------------------------------------------------ *
   * 二、换片/切档：fetch 与 XHR 的 playurl 响应
   * ------------------------------------------------------------------ */
  const origFetch = window.fetch
  if (origFetch) {
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const resp = await origFetch.apply(this, arguments)
      if (!isPlayurl(url)) return resp
      try {
        const text = await resp.clone().text()
        const obj = JSON.parse(text)
        if (rewritePlayurl(obj)) {
          log('fetch playurl 改写', TARGET_HOST)
          return new Response(JSON.stringify(obj), { status: resp.status, statusText: resp.statusText, headers: resp.headers })
        }
      } catch (_) {}
      return resp
    }
  }

  const OX = window.XMLHttpRequest
  if (OX) {
    class X extends OX {
      open(method, url) {
        this.__cdnUrl = url
        return super.open.apply(this, arguments)
      }
      get responseText() { return this.__cdnRewrite(super.responseText) }
      get response() {
        const r = super.response
        return typeof r === 'string' ? this.__cdnRewrite(r) : r
      }
      __cdnRewrite(raw) {
        if (this.readyState !== 4 || typeof raw !== 'string' || !isPlayurl(this.__cdnUrl)) return raw
        try {
          const obj = JSON.parse(raw)
          if (rewritePlayurl(obj)) { log('xhr playurl 改写', TARGET_HOST); return JSON.stringify(obj) }
        } catch (_) {}
        return raw
      }
    }
    window.XMLHttpRequest = X
  }

  log('已启用 →', TARGET_HOST)
})()
