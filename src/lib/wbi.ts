import { md5 } from './md5'
import { gmRequest } from '../feed/app-api'

/**
 * B 站 web 端 wbi 签名（playurl 等 /wbi/ 接口需要）。
 * 原理：nav 接口给出 img_key/sub_key（每日轮换）→ 按固定 64 位重排表洗出 mixinKey →
 * 参数并入 wts、按 key 排序、值过滤特殊字符后 urlencode，追加 mixinKey 求 md5 得 w_rid。
 * 与原生首页 hover 预览走的是同一条路（探针实测 www 用 x/player/wbi/playurl）。
 */

// 固定重排表（社区公开算法）
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]
const mixinKey = (orig: string) => MIXIN_TAB.map((n) => orig[n]).join('').slice(0, 32)

const REF = { Referer: 'https://www.bilibili.com/' }
const LS_KEY = 'bilikit:wbi' // 缓存当日 keys，避免每次 hover 都打 nav

let keysPromise: Promise<{ img: string; sub: string } | null> | null = null

function todayStamp(): number {
  // 不用 Date.now 的“当天”粒度：用秒级时间戳整除一天，够判是否隔日
  return Math.floor(Date.now() / 86400000)
}

async function fetchKeys(): Promise<{ img: string; sub: string } | null> {
  // 先看本地缓存（同一天直接用）
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (c && c.day === todayStamp() && c.img && c.sub) return { img: c.img, sub: c.sub }
  } catch { /* ignore */ }
  try {
    const t = await gmRequest({ method: 'GET', url: 'https://api.bilibili.com/x/web-interface/nav', headers: REF })
    const w = JSON.parse(t)?.data?.wbi_img
    const base = (u: string) => (u || '').split('/').pop()!.split('.')[0]
    const img = base(w?.img_url), sub = base(w?.sub_url)
    if (!img || !sub) return null
    try { localStorage.setItem(LS_KEY, JSON.stringify({ img, sub, day: todayStamp() })) } catch { /* ignore */ }
    return { img, sub }
  } catch { return null }
}

function getKeys(): Promise<{ img: string; sub: string } | null> {
  // 失败不长缓存：一次 nav 失败若把 null 永久缓存，会让整会话所有预览彻底失效。拿到 null 就清掉，下次重试。
  if (!keysPromise) {
    keysPromise = fetchKeys().catch(() => null).then((k) => { if (!k) keysPromise = null; return k })
  }
  return keysPromise
}

/** 给一组参数做 wbi 签名，返回带 wts/w_rid 的完整 query 串；取不到 keys 时返回 null。 */
export async function signWbi(params: Record<string, string | number>): Promise<string | null> {
  const keys = await getKeys()
  if (!keys) return null
  const mk = mixinKey(keys.img + keys.sub)
  const wts = Math.floor(Date.now() / 1000)
  const q: Record<string, string | number> = { ...params, wts }
  const query = Object.keys(q)
    .sort()
    .map((k) => {
      const v = String(q[k]).replace(/[!'()*]/g, '') // 过滤特殊字符，否则签名不符
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    })
    .join('&')
  return `${query}&w_rid=${md5(query + mk)}`
}

export const WBI_REF = REF
