import { md5 } from './md5'

/**
 * B 站 TV 端 app-api 签名（见 docs/RESEARCH-feed.md）。
 * TV 端公开泄露 appkey/appsec，可 MD5 签名。Core（登录，页面 fetch）与 Feed（拉流，GM）共用。
 */
export const APPKEY = '4409e2ce8ffd12b8'
export const APPSEC = '59b43e04ad6965f34319062b478f83dd'

/** 并入 appkey → 按 key 排序拼 query → 追加 appsec 后 md5，得 sign，拼回。 */
export function signAppQuery(params: Record<string, string>): string {
  const p: Record<string, string> = { appkey: APPKEY, ...params }
  const sorted = Object.keys(p)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(p[k])}`)
    .join('&')
  return `${sorted}&sign=${md5(sorted + APPSEC)}`
}
