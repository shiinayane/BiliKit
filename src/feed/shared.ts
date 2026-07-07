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

// 读共享设置（与 Core 面板同一份 localStorage）。key 缺失/解析失败回落 fallback。
export function readSetting<T>(key: string, fallback: T): T {
  try {
    const v = (JSON.parse(localStorage.getItem('bilikit:settings') || '{}') as any)[key]
    return v === undefined ? fallback : (v as T)
  } catch {
    return fallback
  }
}
