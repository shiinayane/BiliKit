import { describe, it, expect } from 'vitest'
import { mixinKey, keyFromUrl, signParams } from './wbi-core'

describe('keyFromUrl', () => {
  it('取 URL 末段文件名、去扩展名', () => {
    expect(keyFromUrl('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png')).toBe('7cd084941338484aae1ad9425b84077c')
    expect(keyFromUrl('')).toBe('')
  })
})

describe('mixinKey', () => {
  it('固定 32 字符、确定性', () => {
    const src = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123' // 64 位
    const k = mixinKey(src)
    expect(k).toHaveLength(32)
    expect(mixinKey(src)).toBe(k)
  })
})

describe('signParams', () => {
  const img = '7cd084941338484aae1ad9425b84077c'
  const sub = '4932caff0ff746eab6f01bf08b70ac45'

  it('query 段按键名字典序、末尾带 wts，w_rid 为 32 位十六进制', () => {
    const out = signParams({ foo: '1', bar: '2' }, img, sub, 1700000000)
    expect(out.startsWith('bar=2&foo=1&wts=1700000000&w_rid=')).toBe(true)
    expect(out.split('w_rid=')[1]).toMatch(/^[0-9a-f]{32}$/)
  })

  it("值中的 !'()* 被滤除（B 站 wbi 规则）", () => {
    const out = signParams({ a: "x!y'(z)*" }, img, sub, 1)
    expect(out.startsWith('a=xyz&wts=1&w_rid=')).toBe(true)
  })

  it('确定性：键顺序不影响结果（内部排序）', () => {
    const a = signParams({ qn: 80, bvid: 'BV1' }, img, sub, 123)
    const b = signParams({ bvid: 'BV1', qn: 80 }, img, sub, 123)
    expect(a).toBe(b)
  })

  it('key/wts 变了 w_rid 就变', () => {
    const base = signParams({ qn: 80 }, img, sub, 100)
    expect(signParams({ qn: 80 }, img, sub, 101)).not.toBe(base) // wts 变
    expect(signParams({ qn: 112 }, img, sub, 100)).not.toBe(base) // 参数变
  })
})
