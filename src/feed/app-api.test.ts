import { afterEach, describe, expect, it } from 'vitest'
import { gmRequestBinary } from './app-api'

const oldGM = (globalThis as any).GM

afterEach(() => {
  if (oldGM === undefined) delete (globalThis as any).GM
  else (globalThis as any).GM = oldGM
})

describe('gmRequestBinary abort', () => {
  it('AbortSignal 会中止底层 GM 请求并结算 Promise', async () => {
    let aborted = false
    ;(globalThis as any).GM = {
      xmlHttpRequest(opts: any) {
        return {
          abort() {
            aborted = true
            opts.onabort()
          },
        }
      },
    }
    const controller = new AbortController()
    const pending = gmRequestBinary('https://example.com/video', { start: 0, end: 9 }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(aborted).toBe(true)
  })
})
