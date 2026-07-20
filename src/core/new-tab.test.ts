import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WAYBACK_STACK_KEY,
  consumeHistoryFlattenTarget,
  isHistoryFlattenTargetName,
  isSafariUserAgent,
  newHistoryFlattenTargetName,
  openBiliKitVideoTab,
  shouldUseSafariHistoryFlatten,
} from './new-tab'

describe('new tab history flatten', () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15'
  afterEach(() => vi.unstubAllGlobals())

  it('只识别 Safari，不把 Chrome / Edge / Firefox 当成 Safari', () => {
    expect(isSafariUserAgent(safari, 'Apple Computer, Inc.')).toBe(true)
    expect(isSafariUserAgent(safari.replace('Version/26.0 Safari/605.1.15', 'Chrome/150.0 Safari/605.1.15'), 'Google Inc.')).toBe(false)
    expect(isSafariUserAgent(safari.replace('Version/26.0 Safari/605.1.15', 'Edg/150.0 Safari/605.1.15'), 'Google Inc.')).toBe(false)
    expect(isSafariUserAgent('Mozilla/5.0 Firefox/150.0', '')).toBe(false)
  })

  it('设置开启且浏览器为 Safari 时才启用', () => {
    expect(shouldUseSafariHistoryFlatten(true, safari, 'Apple Computer, Inc.')).toBe(true)
    expect(shouldUseSafariHistoryFlatten(false, safari, 'Apple Computer, Inc.')).toBe(false)
    expect(shouldUseSafariHistoryFlatten(true, 'Mozilla/5.0 Firefox/150.0', '')).toBe(false)
  })

  it('只接受格式严格的一次性 target name', () => {
    expect(isHistoryFlattenTargetName(newHistoryFlattenTargetName('abc12345-test'))).toBe(true)
    expect(isHistoryFlattenTargetName('bilikit-newtab-flatten-short')).toBe(false)
    expect(isHistoryFlattenTargetName('bilikit-newtab-flatten-abc12345?bad')).toBe(false)
    expect(isHistoryFlattenTargetName('ordinary-tab')).toBe(false)
  })

  it('Safari 实验模式保留 opener，并在 open 瞬间摘掉再恢复来源回程栈', () => {
    const store = new Map([[WAYBACK_STACK_KEY, '[{"url":"source"}]']])
    const open = vi.fn((_url: string, _target?: string, _features?: string) => null)
    vi.stubGlobal('navigator', { userAgent: safari, vendor: 'Apple Computer, Inc.' })
    vi.stubGlobal('window', { open })
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    })

    openBiliKitVideoTab('https://www.bilibili.com/video/BV1TEST', true)

    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][0]).toContain('/video/BV1TEST')
    expect(isHistoryFlattenTargetName(String(open.mock.calls[0][1]))).toBe(true)
    expect(open.mock.calls[0][2]).toBeUndefined()
    expect(store.get(WAYBACK_STACK_KEY)).toBe('[{"url":"source"}]')
  })

  it('关闭实验或非 Safari 时仍走 noopener', () => {
    const open = vi.fn((_url: string, _target?: string, _features?: string) => null)
    vi.stubGlobal('navigator', { userAgent: safari, vendor: 'Apple Computer, Inc.' })
    vi.stubGlobal('window', { open })
    openBiliKitVideoTab('https://www.bilibili.com/video/BV1TEST', false)
    expect(open).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1TEST', '_blank', 'noopener')
  })

  it('目标页只消费一次标记并立即清空 window.name', () => {
    const fakeWindow: Record<string, unknown> = { name: newHistoryFlattenTargetName('abc12345-test') }
    fakeWindow.top = fakeWindow
    fakeWindow.self = fakeWindow
    vi.stubGlobal('window', fakeWindow)
    expect(consumeHistoryFlattenTarget()).toBe(true)
    expect(fakeWindow.name).toBe('')
    expect(consumeHistoryFlattenTarget()).toBe(false)
  })
})
