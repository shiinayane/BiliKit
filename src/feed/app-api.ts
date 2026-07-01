import { signAppQuery } from '../lib/app-sign'

/**
 * B 站 App 推荐接口封装（见 docs/RESEARCH-feed.md）。
 * access_key 空 = 匿名热门流。跨域 app.bilibili.com 不给 CORS → 走 GM.xmlHttpRequest（Feed @grant 了它）。
 */
declare const GM: any
declare const GM_xmlhttpRequest: any

// 日志脱敏：抹掉 URL 里的 access_key，避免账号 token 进 console
const redactKey = (u: string) => (u || '').replace(/(access_key=)[^&]*/i, '$1<redacted>')

/** GM 跨域请求（GET/POST）。GM.xmlHttpRequest / GM_xmlhttpRequest 都是 onload 回调式，统一包成 Promise。 */
export function gmRequest(opts: { method: string; url: string; data?: string; headers?: Record<string, string>; anonymous?: boolean }): Promise<string> {
  const xhr = typeof GM !== 'undefined' && GM && GM.xmlHttpRequest
    ? GM.xmlHttpRequest.bind(GM)
    : typeof GM_xmlhttpRequest !== 'undefined'
      ? GM_xmlhttpRequest
      : null
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

export interface FeedCard {
  goto: string
  title: string
  up: string
  face: string // UP 头像 URL（avatar.cover）
  cover: string
  uri: string
  bvid: string
  aid: string
  duration: string
  play: string
  danmaku: string // 弹幕数（cover_left_text_3）
  date: string // 发布日期，如「6月11日」——仅存在于 desc 文本，无原始时间戳
  reason: string // 推荐理由，如「已关注」（bottom_rcmd_reason）
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
    face: (item.avatar && item.avatar.cover) || '',
    cover: item.cover || '',
    uri: item.uri || '',
    bvid: item.bvid || pa.bvid || '',
    aid: String(args.aid || pa.aid || item.param || ''),
    duration: item.cover_left_text_1 || '', // 时长（实测在 text_1，如 13:02）
    play: item.cover_left_text_2 || '', // 观看数（实测在 text_2，如 25.4万观看）
    danmaku: item.cover_left_text_3 || '', // 弹幕数（如 13弹幕）
    date: descDate(item.desc || ''),
    reason: item.bottom_rcmd_reason || '',
  }
}

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
  const cards = items.map(normalize).filter((c): c is FeedCard => !!c && c.goto === 'av')
  // code 归一为 number：缺失/非数字一律当失败(-1)，避免调用方 `===0`/`!code` 误判
  const code = typeof json?.code === 'number' ? json.code : -1
  return { code, message: json?.message || '', cards, raw: json }
}
