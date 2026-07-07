import { gmRequest } from './app-api'
import { signAppQuery } from '../lib/app-sign'
import { NS } from './shared'
import type { FeedCard } from './app-api'

/**
 * 卡片操作：稍后再看 / 我不想看（反馈到 B 站，调教推荐）。
 * - 我不想看：App 反馈接口 /x/feed/dislike（+/cancel），reason_id 取自条目自带 three_point，需 access_key。
 * - 稍后再看：账户操作，需真登录——网页已登录用 cookie+csrf 走 web 接口，否则用 access_key 走 app 接口。
 * access_key 只进 app/api 主机的请求，绝不落进 cookie（与 fetchAppFeed 同源策略）。
 */

type Res = { ok: boolean; message: string }

function accessKey(): string {
  try { return (JSON.parse(localStorage.getItem('bilikit:settings') || '{}') as any)['feed.accessKey'] || '' } catch { return '' }
}

// 网页登录态的 csrf（bili_jct，非 HttpOnly、可读）；空=未网页登录
function biliJct(): string {
  const m = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

const nowIdx = (): string => String(Math.floor(Date.now() / 1000))

// —— 我不想看 / 撤销 ——（App 推荐反馈；GET 到 app.bilibili.com，app 签名）
async function feedDislike(card: FeedCard, reasonId: number, cancel: boolean): Promise<Res> {
  const key = accessKey()
  if (!key) return { ok: false, message: '未配置 access_key，无法提交反馈' }
  const query = signAppQuery({
    access_key: key,
    build: '1',
    mobi_app: 'iphone',
    device: 'pad',
    goto: card.goto || 'av',
    id: card.param || card.aid,
    reason_id: String(reasonId),
    idx: nowIdx(),
  })
  const path = cancel ? '/x/feed/dislike/cancel' : '/x/feed/dislike'
  try {
    const text = await gmRequest({ method: 'GET', url: `https://app.bilibili.com${path}?${query}` })
    const json = JSON.parse(text)
    return { ok: json?.code === 0, message: json?.message || (json?.code === 0 ? '' : '失败') }
  } catch { return { ok: false, message: '网络错误' } }
}
export const dislikeVideo = (c: FeedCard, reasonId: number) => feedDislike(c, reasonId, false)
export const undoDislikeVideo = (c: FeedCard, reasonId: number) => feedDislike(c, reasonId, true)

// —— 稍后再看 / 移除 ——（账户操作；优先 web-cookie，回退 access_key）
async function toview(aid: string, del: boolean): Promise<Res> {
  if (!aid) return { ok: false, message: '缺少视频 id' }
  const path = del ? '/x/v2/history/toview/del' : '/x/v2/history/toview/add'
  const csrf = biliJct()
  // ① 网页已登录：同站 fetch 带 SESSDATA cookie + csrf（api.bilibili.com 与本页同注册域，cookie 随请求发出）
  if (csrf) {
    try {
      const r = await fetch(`https://api.bilibili.com${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `aid=${encodeURIComponent(aid)}&csrf=${encodeURIComponent(csrf)}`,
      })
      const json = await r.json()
      return { ok: json?.code === 0, message: json?.message || '' }
    } catch { return { ok: false, message: '网络错误' } }
  }
  // ② 未网页登录：用 access_key 走 app 签名（GM 跨域）。免登录用户走这条
  const key = accessKey()
  if (!key) return { ok: false, message: '需网页登录或在设置里配置 access_key' }
  const query = signAppQuery({ access_key: key, build: '1', mobi_app: 'iphone', device: 'pad', aid, idx: nowIdx() })
  try {
    const text = await gmRequest({ method: 'POST', url: `https://api.bilibili.com${path}?${query}` })
    const json = JSON.parse(text)
    return { ok: json?.code === 0, message: json?.message || '' }
  } catch { return { ok: false, message: '网络错误' } }
}
export const watchLaterAdd = (aid: string) => toview(aid, false)
export const watchLaterDel = (aid: string) => toview(aid, true)

// —— 轻量 toast（全局单例，底部居中，2.2s 淡出）——
let toastEl: HTMLElement | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
export function toast(msg: string): void {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = `${NS}-toast`; document.body.appendChild(toastEl) }
  toastEl.textContent = msg
  // 强制重排后再加 .on，确保每次都有淡入过渡（连点也重放）
  void toastEl.offsetWidth
  toastEl.classList.add('on')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl?.classList.remove('on'), 2200)
}
