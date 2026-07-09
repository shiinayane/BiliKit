// Feed 共享常量与小工具（被多个 feed 子模块引用）
export const NS = 'bk-feed'
// 1×1 透明 gif：封面屏外卸载时替换 src，释放解码位图
export const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

export const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[ch])
// http→https（B站部分封面/头像给的是 http）；空串回落到 BLANK
export const coverUrl = (u: string) => (u ? u.replace(/^http:/, 'https:') : BLANK)

// 封面按尺寸+格式协商：B 站图片 CDN 支持在原 URL 后加 `@{w}w_{h}h_1c.{format}` 参数（实测校验，真实封面
// URL 加此参数返回 200 + 正确 content-type）。原图常 1280x720+，卡片网格最窄 300px 宽，
// 640x360 足够覆盖到高分屏又明显小于原图——实测：原图 254KB → 640x360 JPEG 47KB(-81%) → 同尺寸 AVIF 26KB(再-45%)。
// 只用于封面（大图，收益明显）；头像 34px 太小不值得加这层复杂度，仍走 coverUrl()。
export function coverSized(u: string): { avif: string; webp: string; jpg: string } {
  const base = coverUrl(u)
  if (base === BLANK) return { avif: BLANK, webp: BLANK, jpg: BLANK }
  const p = '@640w_360h_1c'
  return { avif: `${base}${p}.avif`, webp: `${base}${p}.webp`, jpg: `${base}${p}` }
}

// —— web 推荐流的原始数字 → 与 app 流一致的显示串 ——
// app 流给的是现成串（"25.4万观看" / "13:02" / "6月11日"）；web 流给原始数字（stat.view / duration 秒 / pubdate 时间戳），
// 这里补齐三个格式化器，产出对齐 app 的显示（数字不带单位，card 的 stripUnit 对二者都幂等）。
export function fmtCount(n: number): string {
  if (!isFinite(n) || n < 0) n = 0
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万'
  return String(n)
}
export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  sec = Math.floor(sec)
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0')
}
export function fmtDate(tsSec: number): string {
  if (!tsSec) return ''
  const d = new Date(tsSec * 1000)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// 读共享设置（与 Core 面板同一份 localStorage）。key 缺失/解析失败回落 fallback。
export function readSetting<T>(key: string, fallback: T): T {
  try {
    const v = (JSON.parse(localStorage.getItem('bilikit:settings') || '{}') as any)[key]
    return v === undefined ? fallback : (v as T)
  } catch {
    return fallback
  }
}
