import { describe, expect, it } from 'vitest'
import { isWakeLockIgnoredVideo } from './index'

describe('isWakeLockIgnoredVideo', () => {
  const video = (...classes: string[]) => ({
    classList: { contains: (name: string) => classes.includes(name) },
  }) as unknown as HTMLVideoElement

  it('排除 Feed 静音悬停预览', () => {
    expect(isWakeLockIgnoredVideo(video('bk-feed-vpreview'))).toBe(true)
  })

  it('保留主播放器视频', () => {
    expect(isWakeLockIgnoredVideo(video('bpx-player-video-wrap'))).toBe(false)
  })
})
