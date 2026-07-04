import { describe, it, expect } from 'vitest'
import { videoIdOf, cleanTitle, dedupeArrival, type Entry } from './core'

const e = (url: string): Entry => ({ url, title: '', t: 0 })

describe('videoIdOf', () => {
  it('各视频页型 → 归一小写 id', () => {
    expect(videoIdOf('/video/BV1Xx411c7mD')).toBe('bv1xx411c7md')
    expect(videoIdOf('/video/av12345')).toBe('av12345')
    expect(videoIdOf('/bangumi/play/ep456')).toBe('ep456')
    expect(videoIdOf('/bangumi/play/ss789')).toBe('ss789')
    expect(videoIdOf('/cheese/play/ep1')).toBe('ep1')
    expect(videoIdOf('/list/watchlater?bvid=BV1abc')).toBe('bv1abc')
    expect(videoIdOf('https://www.bilibili.com/video/BV1Foo?p=2&t=3')).toBe('bv1foo')
  })
  it('非视频 / 垃圾输入 → 空串', () => {
    expect(videoIdOf('/')).toBe('')
    expect(videoIdOf('/anzhuang')).toBe('')
    expect(videoIdOf('not a url', 'not a base')).toBe('')
  })
  it('ss 与 ep 是不同 id（用于 ss→ep 规范化判定）', () => {
    expect(videoIdOf('/bangumi/play/ss1')).not.toBe(videoIdOf('/bangumi/play/ep1'))
  })
})

describe('cleanTitle', () => {
  it('剥掉站点后缀段', () => {
    expect(cleanTitle('某视频标题_哔哩哔哩_bilibili')).toBe('某视频标题')
    expect(cleanTitle('番剧名字_番剧_bilibili')).toBe('番剧名字')
    expect(cleanTitle('纯标题不带后缀')).toBe('纯标题不带后缀')
    expect(cleanTitle('')).toBe('')
  })
})

describe('dedupeArrival', () => {
  it('栈顶 == 当前视频 → 弹掉', () => {
    const s = [e('/video/BV1'), e('/video/BV2')]
    expect(dedupeArrival(s, 'bv2').map((x) => x.url)).toEqual(['/video/BV1'])
  })
  it('栈顶 != 当前 → 原样返回（同引用）', () => {
    const s = [e('/video/BV1'), e('/video/BV2')]
    expect(dedupeArrival(s, 'bv3')).toBe(s)
  })
  it('尾部连续同视频全部弹掉', () => {
    const s = [e('/video/BV1'), e('/video/BV2'), e('/video/BV2')]
    expect(dedupeArrival(s, 'bv2').map((x) => x.url)).toEqual(['/video/BV1'])
  })
  it('backRestore：回退到最近一层当前视频、并弹掉它', () => {
    const s = [e('/video/BV1'), e('/video/BV2'), e('/video/BV3')]
    expect(dedupeArrival(s, 'bv2', undefined, true).map((x) => x.url)).toEqual(['/video/BV1'])
  })
  it('空 curId → 不动', () => {
    const s = [e('/video/BV1')]
    expect(dedupeArrival(s, '')).toBe(s)
  })
})
