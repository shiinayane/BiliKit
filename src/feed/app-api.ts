import { signAppQuery } from '../lib/app-sign'

/**
 * B 站 App 推荐接口封装（见 docs/RESEARCH-feed.md）。
 * access_key 空 = 匿名热门流。跨域 app.bilibili.com 不给 CORS → 走 GM.xmlHttpRequest（Feed @grant 了它）。
 */
declare const GM: any
declare const GM_xmlhttpRequest: any

// 日志脱敏：抹掉 URL 里的 access_key，避免账号 token 进 console
const redactKey = (u: string) => (u || '').replace(/(access_key=)[^&]*/i, '$1<redacted>')

function gmXhr(): any {
  return typeof GM !== 'undefined' && GM && GM.xmlHttpRequest
    ? GM.xmlHttpRequest.bind(GM)
    : typeof GM_xmlhttpRequest !== 'undefined'
      ? GM_xmlhttpRequest
      : null
}

/**
 * GM 抓二进制字节（带 Range）。MSE 预览用：upos 流无 CORS，fetch() 会被拦，只能走 GM 特权跨域拿 arraybuffer。
 * range 传 [start,end]（含端点，对应 HTTP `bytes=start-end`）。
 */
export function gmRequestBinary(url: string, range?: { start: number; end: number }): Promise<ArrayBuffer> {
  const xhr = gmXhr()
  if (!xhr) return Promise.reject(new Error('GM.xmlHttpRequest 不可用'))
  const headers: Record<string, string> = { Referer: 'https://www.bilibili.com/' }
  if (range) headers.Range = `bytes=${range.start}-${range.end}`
  return new Promise((resolve, reject) => {
    xhr({
      method: 'GET', url, headers, responseType: 'arraybuffer', timeout: 15000,
      onload: (r: any) => {
        // Range 请求成功必须是 206 Partial Content；镜像 403/错误页会是 200/403 + 小 body，
        // 若不判 status 就会把 282 字节的错误页当有效数据 append 进去 → 花屏/不播。判 206 → 逐个换候选主机。
        const okStatus = range ? r.status === 206 : (r.status >= 200 && r.status < 300)
        if (!okStatus) { reject(new Error('HTTP ' + r.status)); return }
        const buf = r.response
        if (buf instanceof ArrayBuffer && buf.byteLength) resolve(buf)
        else reject(new Error('空/非二进制响应 status=' + r.status))
      },
      onerror: (r: any) => reject(new Error('网络错误 ' + (r && r.status))),
      ontimeout: () => reject(new Error('超时')),
      onabort: () => reject(new Error('中止')),
    })
  })
}

/** GM 跨域请求（GET/POST）。GM.xmlHttpRequest / GM_xmlhttpRequest 都是 onload 回调式，统一包成 Promise。 */
export function gmRequest(opts: { method: string; url: string; data?: string; headers?: Record<string, string>; anonymous?: boolean }): Promise<string> {
  const xhr = gmXhr()
  if (!xhr) return Promise.reject(new Error('GM.xmlHttpRequest 不可用（Feed 需 @grant GM.xmlHttpRequest）'))
  return new Promise((resolve, reject) => {
    xhr({
      method: opts.method,
      url: opts.url,
      data: opts.data,
      headers: opts.headers || (opts.data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined),
      anonymous: opts.anonymous, // 不带 cookie —— passport 风控对带 web cookie 的请求会回 412 HTML
      timeout: 15000,
      onload: (r: any) => {
        const t = r.responseText || ''
        if (t.trimStart().startsWith('<')) {
          // 诊断：返回 HTML 而非 JSON（多为风控/登录拦截）。注意 access_key 脱敏、不打响应头(可能含 Set-Cookie)。
          console.error('[BiliKit Feed] 非 JSON 响应（可能被风控/登录拦截）：',
            'status =', r.status, r.statusText,
            'url =', redactKey(r.finalUrl || opts.url),
            '\n  正文(前 300) =\n', t.slice(0, 300))
        }
        resolve(t)
      },
      onerror: (r: any) => { console.error('[BiliKit Feed] onerror：', r && r.status); reject(new Error('网络错误')) },
      ontimeout: () => reject(new Error('请求超时')),
      onabort: () => reject(new Error('请求被中止')), // 否则中止时 Promise 永不 settle → 上游 loading 卡死
    })
  })
}

// 「我不想看」反馈项：来自 item.three_point.dislike_reasons，id 是提交给 /x/feed/dislike 的 reason_id。
export interface DislikeReason { id: number; name: string; toast: string }

export interface FeedCard {
  goto: string
  title: string
  up: string
  mid: string // UP 的空间 id（args.up_id / avatar.up_id）——点头像/名字进 space
  face: string // UP 头像 URL（avatar.cover）
  cover: string
  uri: string
  bvid: string
  aid: string
  cid: string // 分 P cid，playurl 必需；App feed 的 player_args 常带，缺则预览时用 pagelist 兜底
  param: string // App 推荐条目 id（dislike 接口的 id 参数 = item.param；av 条目即 aid）
  duration: string
  play: string
  danmaku: string // 弹幕数（cover_left_text_3）
  date: string // 发布日期，如「6月11日」——仅存在于 desc 文本，无原始时间戳
  reason: string // 推荐理由，如「已关注」（bottom_rcmd_reason）
  dislikeReasons: DislikeReason[] // 三点菜单「我不想看」的可选理由；空数组=该条不支持反馈（不显菜单）
}

// desc 形如「UP名 · 6月11日」或仅「UP名」。取「·」后一段当日期；没有则空。
function descDate(desc: string): string {
  if (!desc) return ''
  const i = desc.lastIndexOf(' · ')
  return i >= 0 ? desc.slice(i + 3).trim() : ''
}

function normalize(item: any): FeedCard | null {
  if (!item || typeof item !== 'object') return null
  const args = item.args || {}
  const pa = item.player_args || {}
  return {
    goto: item.goto || '',
    title: item.title || '',
    up: args.up_name || '',
    mid: String(args.up_id || (item.avatar && item.avatar.up_id) || ''),
    face: (item.avatar && item.avatar.cover) || '',
    cover: item.cover || '',
    uri: item.uri || '',
    bvid: item.bvid || pa.bvid || '',
    aid: String(args.aid || pa.aid || item.param || ''),
    cid: String(pa.cid || args.cid || item.cid || ''), // player_args.cid 常有；无则预览时 pagelist 兜底
    param: String(item.param || args.aid || pa.aid || ''), // dislike 接口的 id
    duration: item.cover_left_text_1 || '', // 时长（实测在 text_1，如 13:02）
    play: item.cover_left_text_2 || '', // 观看数（实测在 text_2，如 25.4万观看）
    danmaku: item.cover_left_text_3 || '', // 弹幕数（如 13弹幕）
    date: descDate(item.desc || ''),
    reason: item.bottom_rcmd_reason || '',
    dislikeReasons: Array.isArray(item.three_point?.dislike_reasons)
      ? item.three_point.dislike_reasons
          .filter((r: any) => r && typeof r.id === 'number')
          .map((r: any) => ({ id: r.id, name: String(r.name || ''), toast: String(r.toast || '') }))
      : [],
  }
}

// 首次拉到数据时打印一条 three_point 样本——「我不想看」reason 的真实 id/name 只有真机响应里才有，
// 打出来便于校对菜单映射（不含 access_key，安全）。只打一次。
let _dumpedTP = false

/** 拉一页 App 推荐。accessKey 空串 = 匿名。返回归一化视频卡 + 原始 JSON（便于排查字段）。 */
export async function fetchAppFeed(accessKey = ''): Promise<{ code: number; message: string; cards: FeedCard[]; raw: any }> {
  const idx = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)
  const query = signAppQuery({
    build: '1',
    mobi_app: 'iphone',
    device: 'pad',
    idx: String(idx),
    access_key: accessKey,
  })
  const url = `https://app.bilibili.com/x/v2/feed/index?${query}`
  const text = await gmRequest({ method: 'GET', url })
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    // 风控/登录拦截返回 HTML 而非 JSON（gmRequest 已打印诊断）——转成错误码，别让 JSON.parse 抛穿导致骨架卡死
    return { code: -1, message: '响应非 JSON（可能被风控/登录拦截）', cards: [], raw: text }
  }
  const items: any[] = Array.isArray(json?.data?.items) ? json.data.items : [] // 防 items 非数组时 .map 抛错
  if (!_dumpedTP && items.length) {
    _dumpedTP = true
    const sample = items.find((i) => i && i.three_point)?.three_point
    if (sample) console.debug('[BiliKit Feed] three_point 样本（校对「我不想看」reason id/name 用）:', JSON.stringify(sample))
  }
  const cards = items.map(normalize).filter((c): c is FeedCard => !!c && c.goto === 'av')
  // code 归一为 number：缺失/非数字一律当失败(-1)，避免调用方 `===0`/`!code` 误判
  const code = typeof json?.code === 'number' ? json.code : -1
  return { code, message: json?.message || '', cards, raw: json }
}
