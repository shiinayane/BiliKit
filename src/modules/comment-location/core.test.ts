import { describe, expect, it } from 'vitest'
import { commentSexIconUrl, normalizeCommentSex } from './core'

describe('normalizeCommentSex', () => {
  it('保留公开的男女性别', () => {
    expect(normalizeCommentSex('男')).toBe('男')
    expect(normalizeCommentSex('女')).toBe('女')
  })

  it('不显示保密或异常值', () => {
    expect(normalizeCommentSex('保密')).toBeNull()
    expect(normalizeCommentSex('')).toBeNull()
    expect(normalizeCommentSex(undefined)).toBeNull()
    expect(normalizeCommentSex(1)).toBeNull()
  })

  it('复用评论头像悬停卡片的官方图标', () => {
    expect(commentSexIconUrl('男')).toBe('https://i0.hdslb.com/bfs/seed/jinkela/short/webui/user-profile/img/gender_male.png@.avif')
    expect(commentSexIconUrl('女')).toBe('https://i0.hdslb.com/bfs/seed/jinkela/short/webui/user-profile/img/gender_female.png@.avif')
  })
})
