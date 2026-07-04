/**
 * CDN 优选的纯逻辑层（无 DOM/网络）——把 playurl 里的取流地址钉到指定大陆镜像。可单测。
 */
// upos 系（签名与主机无关，可安全换镜像）；akamaized 不在此列，绝不往上套（换主机会 403）。
const UPOS_RE = /^(?:https?:)?\/\/[^/]*\.(?:bilivideo\.com|acgvideo\.(?:com|cn))\//
export const isUpos = (u: unknown): boolean => typeof u === 'string' && UPOS_RE.test(u)
export const swapHost = (u: string, host: string): string => u.replace(/^(?:https?:)?\/\/[^/]+\//, `https://${host}/`)

// 把一条 dash 流（或 durl 段）整体钉到镜像：主=targetHost，备份整列重建为 [primary, ...backups]。
// 只在存在 upos 地址时改（只有 akam 时不动）。原地改 entry，返回是否命中。
export function fixEntry(e: any, targetHost: string, backupHosts: string[]): boolean {
  if (!e || typeof e !== 'object') return false
  const cands: string[] = []
  for (const k of ['baseUrl', 'base_url', 'url']) if (typeof e[k] === 'string') cands.push(e[k])
  for (const k of ['backupUrl', 'backup_url']) if (Array.isArray(e[k])) cands.push(...e[k].filter((x: any) => typeof x === 'string'))
  const upos = cands.find(isUpos)
  if (!upos) return false
  const primary = swapHost(upos, targetHost)
  const backups = backupHosts.map((h) => swapHost(upos, h))
  for (const k of ['baseUrl', 'base_url', 'url']) if (typeof e[k] === 'string') e[k] = primary
  if (Array.isArray(e.backupUrl)) e.backupUrl = [primary, ...backups]
  if (Array.isArray(e.backup_url)) e.backup_url = [primary, ...backups]
  return true
}

// 改写整个 playurl 对象（兼容网页 data / 番剧 result 两种外层）。原地改，返回是否有命中。
export function rewritePlayurl(root: any, targetHost: string, backupHosts: string[]): boolean {
  if (!root || typeof root !== 'object') return false
  if (root.code !== undefined && root.code !== 0) return false
  const d = root.data || root.result || root
  if (!d || typeof d !== 'object') return false
  let hit = false
  const dash = d.dash
  if (dash) {
    for (const list of [dash.video, dash.audio, dash.dolby && dash.dolby.audio]) {
      if (Array.isArray(list)) list.forEach((e: any) => { if (fixEntry(e, targetHost, backupHosts)) hit = true })
    }
    if (dash.flac && dash.flac.audio && fixEntry(dash.flac.audio, targetHost, backupHosts)) hit = true
  }
  if (Array.isArray(d.durl)) d.durl.forEach((e: any) => { if (fixEntry(e, targetHost, backupHosts)) hit = true }) // 非 dash 的 mp4
  return hit
}
