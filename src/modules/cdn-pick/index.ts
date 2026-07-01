import type { BiliKitModule, Cfg } from '../../core/module'

/**
 * CDN 优选：把 B 站视频分片重定向到指定 CDN 镜像，绕开被分到的慢节点（海外 Akamai 等）。
 * 迁移自 scripts/cdn-pick.user.js（逻辑逐字保留）。
 * 不设顶层守卫——需在 Float 抽屉 iframe 与 player.bilibili.com 播放器里也跑。
 * runAt='start'：必须在页面用到 fetch / 设置 __playinfo__ 之前挂钩。
 */
function init(cfg: Cfg): void {
  if ((window as any).__BILIKIT_CDN_PICK__) return
  ;(window as any).__BILIKIT_CDN_PICK__ = true

  // 想换的镜像主机（裸域名）。置空 '' = 关闭。来自设置面板（默认 hwb，日本实测首选）。
  const TARGET_HOST = cfg.get<string>('targetHost')
  // 备用镜像：主镜像打嗝时回退，仍是大陆镜像、绝不回 akam/cosov。
  const BACKUP_HOSTS = ['upos-sz-upcdnbda2.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com']

  const DEBUG = false
  const log = (...a: unknown[]) => { if (DEBUG) console.log('[CDN优选]', ...a) }

  if (!TARGET_HOST) { log('TARGET_HOST 为空，未启用'); return }

  // upos 系（签名与主机无关，可安全换镜像）；akamaized 不在此列，绝不往上套。
  const UPOS_RE = /^(?:https?:)?\/\/[^/]*\.(?:bilivideo\.com|acgvideo\.(?:com|cn))\//
  const isUpos = (u: any) => typeof u === 'string' && UPOS_RE.test(u)
  const swapHost = (u: string, host: string) => u.replace(/^(?:https?:)?\/\/[^/]+\//, `https://${host}/`)

  let rewriteCount = 0

  // 把一条 dash 流（或 durl 段）整体钉到大陆镜像：主=TARGET_HOST，备份整列重建为 [TARGET, ...BACKUP]。
  function fixEntry(e: any): boolean {
    if (!e || typeof e !== 'object') return false
    const cands: string[] = []
    for (const k of ['baseUrl', 'base_url', 'url']) if (typeof e[k] === 'string') cands.push(e[k])
    for (const k of ['backupUrl', 'backup_url']) if (Array.isArray(e[k])) cands.push(...e[k].filter((x: any) => typeof x === 'string'))
    const upos = cands.find(isUpos)
    if (!upos) return false // 没有任何 upos 地址（只有 akam）→ 不动（换主机会 403）
    const primary = swapHost(upos, TARGET_HOST)
    const backups = BACKUP_HOSTS.map((h) => swapHost(upos, h))
    for (const k of ['baseUrl', 'base_url', 'url']) if (typeof e[k] === 'string') e[k] = primary
    if (Array.isArray(e.backupUrl)) e.backupUrl = [primary, ...backups]
    if (Array.isArray(e.backup_url)) e.backup_url = [primary, ...backups]
    rewriteCount++
    return true
  }

  // 改写整个 playurl 对象（兼容网页 data / 番剧 result 两种外层）
  function rewritePlayurl(root: any): boolean {
    if (!root || typeof root !== 'object') return false
    if (root.code !== undefined && root.code !== 0) return false
    const d = root.data || root.result || root
    if (!d || typeof d !== 'object') return false
    let hit = false
    const dash = d.dash
    if (dash) {
      for (const list of [dash.video, dash.audio, dash.dolby && dash.dolby.audio]) {
        if (Array.isArray(list)) list.forEach((e: any) => { if (fixEntry(e)) hit = true })
      }
      if (dash.flac && dash.flac.audio && fixEntry(dash.flac.audio)) hit = true
    }
    if (Array.isArray(d.durl)) d.durl.forEach((e: any) => { if (fixEntry(e)) hit = true }) // 非 dash 的 mp4
    return hit
  }

  const PLAYURL_PATHS = [
    '/x/player/wbi/playurl', '/x/player/playurl',
    '/pgc/player/web/playurl', '/pgc/player/web/v2/playurl', '/pgc/player/api/playurl',
    '/pugv/player/web/playurl',
  ]
  const isPlayurl = (u: any) => typeof u === 'string' && PLAYURL_PATHS.some((p) => u.includes(p))

  // 一、首帧：window.__playinfo__（服务端内联，早于任何接口）
  let playinfo: any
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

  // 二、换片/切档：fetch 与 XHR 的 playurl 响应（只 hook 主线程）
  const origFetch = window.fetch
  if (origFetch) {
    window.fetch = async function (input: any, init?: any) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input || '')
      const resp = await origFetch.apply(this, arguments as any)
      if (!isPlayurl(url)) return resp
      try {
        const text = await resp.clone().text()
        const obj = JSON.parse(text)
        if (rewritePlayurl(obj)) {
          log('fetch playurl 改写', TARGET_HOST)
          // 剥掉 content-length / content-encoding——正文已解码且长度变了
          const headers = new Headers(resp.headers)
          headers.delete('content-length')
          headers.delete('content-encoding')
          return new Response(JSON.stringify(obj), { status: resp.status, statusText: resp.statusText, headers })
        }
      } catch (_) {}
      return resp
    } as any
  }

  const OX = window.XMLHttpRequest
  if (OX) {
    class X extends OX {
      __cdnUrl: any
      open(method: any, url: any) {
        this.__cdnUrl = url
        return super.open.apply(this, arguments as any)
      }
      get responseText() {
        const rt = this.responseType
        if (rt !== '' && rt !== 'text') return super.responseText
        return this.__cdnText(super.responseText)
      }
      get response() {
        const r = super.response
        if (this.readyState !== 4 || !isPlayurl(this.__cdnUrl)) return r
        if (typeof r === 'string') return this.__cdnText(r)
        if (r && typeof r === 'object') { try { if (rewritePlayurl(r)) log('xhr(json) playurl 改写', TARGET_HOST) } catch (_) {} }
        return r
      }
      __cdnText(raw: any) {
        if (this.readyState !== 4 || typeof raw !== 'string' || !isPlayurl(this.__cdnUrl)) return raw
        try {
          const obj = JSON.parse(raw)
          if (rewritePlayurl(obj)) { log('xhr playurl 改写', TARGET_HOST); return JSON.stringify(obj) }
        } catch (_) {}
        return raw
      }
    }
    window.XMLHttpRequest = X as any
  }

  log('已启用 →', TARGET_HOST)
}

export const cdnPick: BiliKitModule = {
  id: 'cdn-pick',
  name: 'CDN 优选',
  description: '视频分片重定向到更快的大陆镜像',
  runAt: 'start',
  settings: [
    {
      key: 'targetHost',
      type: 'select',
      label: 'CDN 镜像节点',
      default: 'upos-sz-mirrorhwb.bilivideo.com',
      options: [
        { label: '华为 hwb（日本实测首选）', value: 'upos-sz-mirrorhwb.bilivideo.com' },
        { label: '百度 upcdnbda2', value: 'upos-sz-upcdnbda2.bilivideo.com' },
        { label: '华为 hw', value: 'upos-sz-mirrorhw.bilivideo.com' },
        { label: '关闭（用 B 站默认分配）', value: '' },
      ],
      hint: '把视频分片钉到该大陆镜像，绕开被分到的慢节点',
    },
  ],
  init,
}
