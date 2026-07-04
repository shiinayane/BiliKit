import { describe, it, expect } from 'vitest'
import { isUpos, swapHost, fixEntry, rewritePlayurl } from './core'

const TARGET = 'upos-sz-mirrorhwb.bilivideo.com'
const BACKUPS = ['upos-sz-upcdnbda2.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com']

describe('isUpos', () => {
  it('只认 bilivideo/acgvideo（akam 系不认，换主机会 403）', () => {
    expect(isUpos('https://upos-hz.bilivideo.com/x.m4s')).toBe(true)
    expect(isUpos('https://xy.acgvideo.com/x.m4s')).toBe(true)
    expect(isUpos('https://foo.akamaized.net/x.m4s')).toBe(false)
    expect(isUpos(123)).toBe(false)
  })
})

describe('swapHost', () => {
  it('只换主机、保留路径与查询', () => {
    expect(swapHost('https://akam.bilivideo.com/upgc/x.m4s?a=1', TARGET)).toBe(`https://${TARGET}/upgc/x.m4s?a=1`)
  })
})

describe('fixEntry', () => {
  it('upos 地址 → 主换镜像、备份整列重建 [primary, ...backups]', () => {
    const e: any = { baseUrl: 'https://akam.bilivideo.com/x.m4s', backupUrl: ['https://c2.bilivideo.com/x.m4s'] }
    expect(fixEntry(e, TARGET, BACKUPS)).toBe(true)
    expect(e.baseUrl).toBe(`https://${TARGET}/x.m4s`)
    expect(e.backupUrl).toEqual([`https://${TARGET}/x.m4s`, `https://${BACKUPS[0]}/x.m4s`, `https://${BACKUPS[1]}/x.m4s`])
  })
  it('只有 akam 地址 → 不动、返回 false（换主机会 403）', () => {
    const e: any = { baseUrl: 'https://foo.akamaized.net/x.m4s', backupUrl: ['https://bar.akamaized.net/x.m4s'] }
    expect(fixEntry(e, TARGET, BACKUPS)).toBe(false)
    expect(e.baseUrl).toBe('https://foo.akamaized.net/x.m4s')
  })
})

describe('rewritePlayurl', () => {
  it('改 dash.video / dash.audio 各流', () => {
    const root: any = { code: 0, data: { dash: { video: [{ baseUrl: 'https://akam.bilivideo.com/v.m4s', backupUrl: [] }], audio: [{ baseUrl: 'https://x.bilivideo.com/a.m4s' }] } } }
    expect(rewritePlayurl(root, TARGET, BACKUPS)).toBe(true)
    expect(root.data.dash.video[0].baseUrl).toBe(`https://${TARGET}/v.m4s`)
    expect(root.data.dash.audio[0].baseUrl).toBe(`https://${TARGET}/a.m4s`)
  })
  it('番剧 result 外层 + durl(mp4) 也覆盖', () => {
    const root: any = { code: 0, result: { durl: [{ url: 'https://x.bilivideo.com/f.flv', backup_url: ['https://y.bilivideo.com/f.flv'] }] } }
    expect(rewritePlayurl(root, TARGET, BACKUPS)).toBe(true)
    expect(root.result.durl[0].url).toBe(`https://${TARGET}/f.flv`)
  })
  it('code != 0 → 整体不动', () => {
    const root: any = { code: -404, data: { dash: { video: [{ baseUrl: 'https://x.bilivideo.com/v.m4s' }] } } }
    expect(rewritePlayurl(root, TARGET, BACKUPS)).toBe(false)
    expect(root.data.dash.video[0].baseUrl).toBe('https://x.bilivideo.com/v.m4s')
  })
})
