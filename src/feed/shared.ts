// Feed 共享常量与小工具（被多个 feed 子模块引用）
export const NS = 'bk-feed'
// 1×1 透明 gif：封面屏外卸载时替换 src，释放解码位图
export const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

export const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[ch])
// http→https（B站部分封面/头像给的是 http）；空串回落到 BLANK
export const coverUrl = (u: string) => (u ? u.replace(/^http:/, 'https:') : BLANK)
