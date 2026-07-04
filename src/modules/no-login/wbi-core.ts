import { md5 } from '../../lib/md5'

/**
 * Core（@grant none，无 GM）版 wbi 签名：给 playurl 请求重签用。
 * key 来源与 beefreely 同法——直接读 **B 站播放器自己缓存进 localStorage 的** `wbi_img_url` / `wbi_sub_url`，
 * 截文件名即 imgKey/subKey，**同源、免网络、免 GM**。缺失时用「捕获的原生 fetch」打一次 nav 兜底并缓存。
 * 算法（mixin 表 + md5）与 src/lib/wbi.ts 逐字一致，只是换了 key 来源。
 */
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]
export const mixinKey = (orig: string) => MIXIN_TAB.map((n) => orig[n]).join('').slice(0, 32)
export const keyFromUrl = (u: string) => (u ? u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.')) : '')

/**
 * 纯 wbi 签名：给定参数 + imgKey/subKey + wts（秒），返回完整 query 串（含 wts 与 w_rid）。
 * 无 DOM / 时间 / 网络依赖——可单测。签名规则：合入 wts → 键名字典序 → 值滤掉 `!'()*` → md5(query+mixinKey)。
 */
export function signParams(params: Record<string, string | number>, imgKey: string, subKey: string, wts: number): string {
  const mk = mixinKey(imgKey + subKey)
  const q: Record<string, string | number> = { ...params, wts }
  const query = Object.keys(q)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(q[k]).replace(/[!'()*]/g, ''))}`)
    .join('&')
  return `${query}&w_rid=${md5(query + mk)}`
}

const LS = 'bilikit:wbi-core' // 自家兜底缓存（当 B 站的 localStorage key 尚未就位时）
const today = () => Math.floor(Date.now() / 86400000) // 天粒度：wbi key 每日轮换，隔日作废
let cache: { img: string; sub: string; day: number } | null = null // 仅缓存「自家兜底」，带按天戳

function readKeys(): { img: string; sub: string } | null {
  // 1) 优先 B 站播放器自己缓存的 key——它每日由页面刷新，**每次现读**、绝不长缓存，天然随轮换更新
  try {
    const img = keyFromUrl(localStorage.getItem('wbi_img_url') || '')
    const sub = keyFromUrl(localStorage.getItem('wbi_sub_url') || '')
    if (img && sub) return { img, sub }
  } catch { /* ignore */ }
  // 2) 自家兜底缓存：内存 / localStorage 都按天戳，隔日即弃（避免用昨天的 key 签今天的名 → w_rid 失效）
  if (cache && cache.day === today()) return { img: cache.img, sub: cache.sub }
  try {
    const c = JSON.parse(localStorage.getItem(LS) || 'null')
    if (c && c.day === today() && c.img && c.sub) { cache = c; return { img: c.img, sub: c.sub } }
  } catch { /* ignore */ }
  return null
}

/** 用捕获的原生 fetch 打一次 nav 拿 key（匿名即可），存自家缓存。key 缺失时后台预热，不阻塞。 */
export function warmKeys(pureFetch: typeof fetch): void {
  if (readKeys()) return
  try {
    pureFetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'omit' })
      .then((r) => r.json())
      .then((j) => {
        const w = j?.data?.wbi_img
        const img = keyFromUrl(w?.img_url || ''), sub = keyFromUrl(w?.sub_url || '')
        if (img && sub) { cache = { img, sub, day: today() }; try { localStorage.setItem(LS, JSON.stringify(cache)) } catch { /* ignore */ } }
      })
      .catch(() => { /* ignore */ })
  } catch { /* ignore */ }
}

/**
 * 给参数对象做 wbi 签名，返回完整 query 串（含 wts/w_rid）；拿不到 key 时返回 null（调用方应放弃改写、维持原请求）。
 */
export function signQuery(params: Record<string, string | number>): string | null {
  const keys = readKeys()
  if (!keys) return null
  return signParams(params, keys.img, keys.sub, Math.floor(Date.now() / 1000))
}
