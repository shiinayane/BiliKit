import { describe, it, expect } from 'vitest'
import { toCookieStore, SENSITIVE } from './settings'

describe('toCookieStore（跨子域 cookie 只放非敏感键）', () => {
  it('登录凭证等敏感键绝不进 cookie', () => {
    const out = toCookieStore({
      'feed.accessKey': 'SECRET_LOGIN_TOKEN',
      'user.token': 'x',
      'a.secret': 'y',
      'b.password': 'z',
      'c.passwd': 'w',
    })
    expect(out).toEqual({}) // 全被滤掉
    expect('feed.accessKey' in out).toBe(false)
  })

  it('普通设置键保留', () => {
    const store = { 'feed.openMode': 'drawer', 'cdn-pick.targetHost': 'upos-sz-mirrorhwb.bilivideo.com', 'mod.no-login': true }
    expect(toCookieStore(store)).toEqual(store)
  })

  it('敏感键判定大小写不敏感', () => {
    expect(SENSITIVE.test('feed.AccessKey')).toBe(true)
    expect(SENSITIVE.test('X.TOKEN')).toBe(true)
    expect(SENSITIVE.test('feed.openMode')).toBe(false)
  })

  it('混合：只漏非敏感，敏感留在本域 localStorage（此处即被剔除）', () => {
    const out = toCookieStore({ 'feed.accessKey': 'a', 'feed.openMode': 'drawer' })
    expect(out).toEqual({ 'feed.openMode': 'drawer' })
  })
})
