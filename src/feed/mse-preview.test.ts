import { afterEach, describe, expect, it } from 'vitest'
import { attachMse } from './mse-preview'

const oldWindow = (globalThis as any).window
const oldURL = globalThis.URL

afterEach(() => {
  if (oldWindow === undefined) delete (globalThis as any).window
  else (globalThis as any).window = oldWindow
  ;(globalThis as any).URL = oldURL
})

describe('attachMse external cleanup', () => {
  it('起播前 teardown 会撤销 objectURL 并把待定 Promise 结算为 false', async () => {
    class FakeMediaSource extends EventTarget {}
    ;(globalThis as any).window = { MediaSource: FakeMediaSource }
    let revoked = ''
    ;(globalThis as any).URL = {
      createObjectURL: () => 'blob:bilikit-test',
      revokeObjectURL: (url: string) => { revoked = url },
    }
    const video: any = {
      src: '',
      addEventListener() {},
      removeEventListener() {},
      pause() {},
      removeAttribute() { this.src = '' },
      load() {},
    }
    const pending = attachMse(video, {
      codecs: 'avc1.64001f',
      urls: ['https://example.com/video'],
      initEnd: 99,
      indexStart: 100,
      indexEnd: 199,
    })
    video.__mseCleanup()
    await expect(pending).resolves.toBe(false)
    expect(revoked).toBe('blob:bilikit-test')
  })
})
