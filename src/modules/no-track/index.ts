import type { BiliKitModule, Cfg } from '../../core/module'
import { SETTINGS_EVENT } from '../../core/settings'

/**
 * 埋点拦截：在页面世界（@grant none）hook fetch / XHR / sendBeacon，命中黑名单直接短路，
 * 不真正发起请求。实测 B 站首页空闲 72s 里 ~65% 的请求是行为遥测 + 广告投放
 * （data.bilibili.com/log/web 一家就占 62%、约 4.7 次/秒），拦掉零功能损失、页面无感。
 *
 * 设计要点：
 *  - runAt='start'：必须在页面用到这些 API 之前挂钩，否则早期埋点漏网。
 *  - 只拦、不改：非黑名单请求原样透传，绝不动 playurl / 登录 / 业务接口。
 *  - 与 cdn-pick 共存：两者都包 fetch/XHR，但作用于「不相交」的 URL 集合（本模块拦遥测/广告，
 *    cdn-pick 只改 playurl 响应），谁先谁后都能正确链式透传。XHR 用 extends 当前构造器实现叠加。
 *  - sendBeacon 是 B 站日志的主要通道（实测 186 次/72s），必须拦；返回 true 伪装成功。
 */
function init(cfg: Cfg): void {
  if ((window as any).__BILIKIT_NO_TRACK__) return
  ;(window as any).__BILIKIT_NO_TRACK__ = true

  const DEBUG = false

  // 纯遥测/行为日志：data.bilibili.com/log 是行为日志通道（占大头）；click-interface 是点击追踪；
  // mcbas/webase 是老埋点通道。这些拦掉对功能零影响。
  // 注意：① 不拦 x/web-goblin —— 那是 B 站反爬/反广告校验，拦掉会让首页陷入重载循环（实测）。
  //       ② 收窄到 data.bilibili.com/log、不再整域拦 —— 免登录伪造登录后 B 站会走 data.bilibili.com 上的
  //          校验路径，整域拦会把它一起 204 掉、致「免登录 + 埋点拦截」同开时页面反复重刷。想更狠可自加自定义。
  const TELEMETRY = [
    'data.bilibili.com/log',
    'api.bilibili.com/x/click-interface/click',
    'mcbas.',
    'webase',
  ]
  // 广告投放（可在面板单独关）：cm = commercial，广告内容/计费接口。
  const ADS = ['cm.bilibili.com']

  const parseCustom = (s: string) => (s || '').split('\n').map((x) => x.trim()).filter(Boolean)

  // 可变，随面板即时更新（无需刷新）：hook 已装好，只重读这两个开关值。
  let adsOn = cfg.get<boolean>('blockAds') !== false
  let custom = parseCustom(cfg.get<string>('custom'))
  try {
    window.addEventListener(SETTINGS_EVENT, () => {
      adsOn = cfg.get<boolean>('blockAds') !== false
      custom = parseCustom(cfg.get<string>('custom'))
    })
  } catch (_) {}

  let blocked = 0
  const stats = () => ({ blocked })
  ;(window as any).__BILIKIT_NOTRACK_STATS__ = stats

  function isBlocked(input: any): boolean {
    let u: string
    if (typeof input === 'string') u = input
    else if (input && typeof input.url === 'string') u = input.url // Request 对象
    else { try { u = String(input) } catch (_) { return false } }
    if (!u) return false
    for (const p of TELEMETRY) if (u.includes(p)) return true
    if (adsOn) for (const p of ADS) if (u.includes(p)) return true
    for (const p of custom) if (u.includes(p)) return true
    return false
  }
  function hit(u: any): void {
    blocked++
    if (DEBUG) console.log('[埋点拦截] 已拦', typeof u === 'string' ? u : (u && u.url) || u)
  }

  // 一、fetch：命中返回空 204，业务代码拿到 resp.ok===false 但通常不看遥测响应。
  const origFetch = window.fetch
  if (origFetch) {
    window.fetch = function (input: any, init?: any) {
      if (isBlocked(input)) {
        hit(input)
        return Promise.resolve(new Response(null, { status: 204, statusText: 'No Content' }))
      }
      return origFetch.apply(this, arguments as any)
    } as any
  }

  // 二、sendBeacon：日志主通道。命中直接返回 true（伪装入队成功），不发。
  if (navigator.sendBeacon) {
    const origSB = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = function (url: any, data?: any) {
      if (isBlocked(url)) { hit(url); return true }
      return origSB(url, data)
    }
  }

  // 三、XHR：extends 当前构造器（可能已是 cdn-pick 的子类），命中则 send() 空转不发起。
  //     遥测 XHR 是 fire-and-forget，不发起即达成目的；不触发 error 事件以免打扰页面逻辑。
  const OX = window.XMLHttpRequest
  if (OX) {
    class X extends OX {
      private __ntBlocked = false
      private __ntUrl: any = ''
      open(method: any, url: any, ...rest: any[]) {
        this.__ntUrl = url
        this.__ntBlocked = isBlocked(url)
        return super.open(method, url, ...(rest as [any, any, any]))
      }
      send(body?: any) {
        if (this.__ntBlocked) { hit(this.__ntUrl); return }
        return super.send(body)
      }
    }
    window.XMLHttpRequest = X as any
  }

  if (DEBUG) console.log('[埋点拦截] 已启用', { adsOn, custom })
}

export const noTrack: BiliKitModule = {
  id: 'no-track',
  name: '埋点拦截',
  description: '拦掉行为遥测与广告请求，省流量、降开销',
  category: '性能',
  runAt: 'start',
  settings: [
    {
      key: 'blockAds',
      type: 'toggle',
      label: '同时拦广告投放',
      default: true,
      hint: '额外拦截 cm.bilibili.com 广告内容/计费请求；关掉则只拦纯遥测日志（data.bilibili.com 等）',
    },
    {
      key: 'custom',
      type: 'textarea',
      label: '额外拦截（每行一个网址片段）',
      default: '',
      placeholder: '例如 example.com/track',
      hint: '请求 URL 含其中任一片段即拦；留空不额外拦',
    },
  ],
  init,
}
