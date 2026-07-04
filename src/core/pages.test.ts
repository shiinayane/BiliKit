import { describe, it, expect } from 'vitest'
import { isPlayPage } from './pages'

describe('isPlayPage', () => {
  it('命中所有播放页型', () => {
    expect(isPlayPage('/video/BV1xx411c7mD')).toBe(true)
    expect(isPlayPage('/video/av12345')).toBe(true)
    expect(isPlayPage('/bangumi/play/ep123')).toBe(true)
    expect(isPlayPage('/bangumi/play/ss456')).toBe(true)
    expect(isPlayPage('/cheese/play/ep789')).toBe(true)
    expect(isPlayPage('/list/watchlater')).toBe(true)
    expect(isPlayPage('/festival/2024')).toBe(true)
  })

  it('放行浏览/列表页（site-drawer 需在这些页接管）', () => {
    expect(isPlayPage('/')).toBe(false)
    expect(isPlayPage('/index.html')).toBe(false)
    expect(isPlayPage('/1234567')).toBe(false) // space.bilibili.com/<mid>
    expect(isPlayPage('/1234567/video')).toBe(false)
    expect(isPlayPage('/all')).toBe(false) // search
    expect(isPlayPage('/favlist')).toBe(false)
    expect(isPlayPage('/history')).toBe(false)
  })

  it('锚定行首，不被子串误命中', () => {
    expect(isPlayPage('/x/video/foo')).toBe(false)
    expect(isPlayPage('/read/video')).toBe(false)
  })
})
