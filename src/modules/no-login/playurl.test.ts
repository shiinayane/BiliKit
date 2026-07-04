import { describe, it, expect } from 'vitest'
import { playurlParams } from './playurl'

describe('playurlParams（免登录 1080p 参数改写）', () => {
  it('掰回桌面 DASH 试看路径：qn/try_look/platform/fnval/fourk', () => {
    const { base, params } = playurlParams('https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=99&platform=html5&fnval=1&qn=32&w_rid=old&wts=123')
    expect(base).toBe('https://api.bilibili.com/x/player/wbi/playurl')
    expect(params.qn).toBe('80')
    expect(params.try_look).toBe('1')
    expect(params.platform).toBe('pc') // 关键：iPad 的 html5 被掰回 pc
    expect(params.fnval).toBe('4048')
    expect(params.fourk).toBe('1')
  })

  it('去掉旧签名（改了参数必须重签，旧 w_rid/wts 作废）', () => {
    const { params } = playurlParams('https://x/playurl?qn=32&w_rid=deadbeef&wts=111')
    expect('w_rid' in params).toBe(false)
    expect('wts' in params).toBe(false)
  })

  it('保留业务参数（bvid/cid/session 等）', () => {
    const { params } = playurlParams('https://x/playurl?bvid=BV1xy&cid=42&session=abc&otype=json')
    expect(params.bvid).toBe('BV1xy')
    expect(params.cid).toBe('42')
    expect(params.session).toBe('abc')
    expect(params.otype).toBe('json')
  })
})
