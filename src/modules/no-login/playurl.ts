/**
 * 免登录 playurl 请求参数改写（纯逻辑，不含签名）——可单测。
 * 免登录看 1080p 的核心：把播放器发的 playurl 参数掰成「桌面 DASH + 试看」路径。
 *   - 去掉旧 w_rid/wts（改了参数必须重签，旧签名作废）
 *   - qn=80(1080p) + try_look=1(未登录试看)
 *   - platform=pc + fnval=4048(全 DASH) + fourk=1：iPad/移动 Safari 会发 platform=html5，
 *     服务端对 html5 的免登录试看只给 480p，掰回桌面策略才放行 1080p。
 * 其余参数（bvid/cid/session 等）原样保留。签名由调用方另做（wbi-core.signQuery）。
 */
export function playurlParams(url: string): { base: string; params: Record<string, string> } {
  const [base, qs = ''] = url.split('?')
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(qs))
  delete params.w_rid
  delete params.wts
  params.qn = '80'
  params.try_look = '1'
  params.platform = 'pc'
  params.fnval = '4048'
  params.fourk = '1'
  return { base, params }
}
