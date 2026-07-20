import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeClassList {
  private values = new Set<string>()
  add(...names: string[]): void { names.forEach((name) => this.values.add(name)) }
  remove(...names: string[]): void { names.forEach((name) => this.values.delete(name)) }
  contains(name: string): boolean { return this.values.has(name) }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.values.has(name)
    if (on) this.values.add(name)
    else this.values.delete(name)
    return on
  }
}

class FakeElement {
  className = ''
  classList = new FakeClassList()
  style: Record<string, string> = {}
  children: FakeElement[] = []
  parent: FakeElement | null = null
  isConnected = false
  private events = new Map<string, Array<(event: unknown) => void>>()
  private controls = new Map<string, FakeElement>()

  set innerHTML(value: string) {
    if (value.includes('bk-newtab')) this.controls.set('.bk-newtab', new FakeElement())
    if (value.includes('bk-close')) this.controls.set('.bk-close', new FakeElement())
  }

  append(...nodes: FakeElement[]): void { nodes.forEach((node) => this.appendChild(node)) }
  appendChild(node: FakeElement): FakeElement {
    node.remove()
    node.parent = this
    this.children.push(node)
    node.setConnected(this.isConnected)
    return node
  }
  insertBefore(node: FakeElement, before: FakeElement | null): FakeElement {
    node.remove()
    node.parent = this
    const index = before ? this.children.indexOf(before) : -1
    if (index < 0) this.children.push(node)
    else this.children.splice(index, 0, node)
    node.setConnected(this.isConnected)
    return node
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
    this.setConnected(false)
  }
  setConnected(value: boolean): void {
    this.isConnected = value
    this.children.forEach((child) => child.setConnected(value))
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.events.get(type) || []
    list.push(listener)
    this.events.set(type, list)
  }
  querySelector(selector: string): FakeElement | null { return this.controls.get(selector) || null }
  focus(): void { /* test double */ }
  blur(): void { /* test double */ }
}

interface PostedMessage { data: Record<string, unknown>; origin: string }

class FakeIframe extends FakeElement {
  name = ''
  src = ''
  allow = ''
  allowFullscreen = false
  contentWindow = {
    messages: [] as PostedMessage[],
    postMessage: (data: Record<string, unknown>, origin: string): void => {
      this.contentWindow.messages.push({ data, origin })
    },
    focus: (): void => {},
  }
  setAttribute(): void { /* test double */ }
}

interface DrawerHarness {
  body: FakeElement
  message: (frame: FakeIframe, token: string, type: string, extra?: Record<string, unknown>) => void
  frames: () => FakeIframe[]
}

function installHarness(): DrawerHarness {
  const body = new FakeElement()
  body.setConnected(true)
  const documentElement = new FakeElement()
  documentElement.setConnected(true)
  const head = new FakeElement()
  head.setConnected(true)
  const windowEvents = new Map<string, Array<(event: any) => void>>()
  const documentEvents = new Map<string, Array<(event: any) => void>>()
  const fakeLocation = { href: 'https://www.bilibili.com/', origin: 'https://www.bilibili.com' }

  class FakeHistory {
    state: unknown = null
    pushState(state: unknown, _unused: string, url?: string | URL | null): void {
      this.state = state
      if (url != null) fakeLocation.href = new URL(String(url), fakeLocation.href).href
    }
    replaceState(state: unknown, _unused: string, url?: string | URL | null): void {
      this.state = state
      if (url != null) fakeLocation.href = new URL(String(url), fakeLocation.href).href
    }
    back(): void { /* popstate is driven explicitly when needed */ }
  }

  const fakeDocument = {
    body,
    head,
    documentElement,
    createElement: (tag: string): FakeElement => tag === 'iframe' ? new FakeIframe() : new FakeElement(),
    addEventListener: (type: string, listener: (event: any) => void): void => {
      const list = documentEvents.get(type) || []
      list.push(listener)
      documentEvents.set(type, list)
    },
  }
  const fakeWindow = {
    addEventListener: (type: string, listener: (event: any) => void): void => {
      const list = windowEvents.get(type) || []
      list.push(listener)
      windowEvents.set(type, list)
    },
    focus: (): void => {},
    open: (): void => null,
  }

  vi.stubGlobal('History', FakeHistory)
  vi.stubGlobal('history', new FakeHistory())
  vi.stubGlobal('location', fakeLocation)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })

  const walk = (root: FakeElement): FakeIframe[] => root.children.flatMap((child) => [
    ...(child instanceof FakeIframe && child.className === 'bk-dframe' ? [child] : []),
    ...walk(child),
  ])
  return {
    body,
    frames: () => walk(body),
    message: (frame, token, type, extra = {}) => {
      const event = {
        source: frame.contentWindow,
        origin: 'https://www.bilibili.com',
        data: { type, token, ...extra },
      }
      windowEvents.get('message')?.forEach((listener) => listener(event))
    },
  }
}

function lastPosted(frame: FakeIframe, type: string): Record<string, unknown> {
  const message = [...frame.contentWindow.messages].reverse().find((item) => item.data.type === type)
  if (!message) throw new Error(`missing ${type}`)
  return message.data
}

describe('drawer document navigation lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('landing watchdog 只重建一个 iframe 并优先最后排队目标', async () => {
    const harness = installHarness()
    const { openDrawer } = await import('./drawer')
    openDrawer('https://www.bilibili.com/video/BV1AA')
    const original = harness.frames()[0]
    const tokenA = original.name.split(':')[1]
    harness.message(original, tokenA, 'bk-drawer-ready')

    openDrawer('https://www.bilibili.com/video/BV1BB')
    harness.message(original, tokenA, 'bk-drawer-suspended')
    const replaceB = lastPosted(original, 'bk-drawer-replace')
    harness.message(original, tokenA, 'bk-drawer-replacing', { nextToken: replaceB.nextToken })
    openDrawer('https://www.bilibili.com/video/BV1CC')

    await vi.advanceTimersByTimeAsync(15_000)
    const frames = harness.frames()
    expect(frames).toHaveLength(1)
    expect(original.isConnected).toBe(false)
    expect(frames[0].src).toContain('/video/BV1CC#bk-drawer')
  })

  it('新 nonce 首条消息会取消 watchdog，立即切最后目标而不等中间首帧', async () => {
    const harness = installHarness()
    const { openDrawer } = await import('./drawer')
    openDrawer('https://www.bilibili.com/video/BV1AA')
    const frame = harness.frames()[0]
    const tokenA = frame.name.split(':')[1]
    harness.message(frame, tokenA, 'bk-drawer-ready')

    openDrawer('https://www.bilibili.com/video/BV1BB')
    harness.message(frame, tokenA, 'bk-drawer-suspended')
    const replaceB = lastPosted(frame, 'bk-drawer-replace')
    const tokenB = String(replaceB.nextToken)
    harness.message(frame, tokenA, 'bk-drawer-replacing', { nextToken: tokenB })
    openDrawer('https://www.bilibili.com/video/BV1CC')

    // B 的初始 suspended 就是可信握手；不需要等 bk-drawer-ready。
    harness.message(frame, tokenB, 'bk-drawer-suspended')
    harness.message(frame, tokenB, 'bk-drawer-suspended')
    const replaceC = lastPosted(frame, 'bk-drawer-replace')
    expect(String(replaceC.url)).toContain('/video/BV1CC#bk-drawer')
    const tokenC = String(replaceC.nextToken)
    harness.message(frame, tokenB, 'bk-drawer-replacing', { nextToken: tokenC })
    harness.message(frame, tokenC, 'bk-drawer-ready')

    await vi.advanceTimersByTimeAsync(15_000)
    expect(harness.frames()).toEqual([frame])
    expect(frame.isConnected).toBe(true)
  })
})
