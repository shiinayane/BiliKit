import type { BiliKitModule, Cfg } from './module'

/**
 * 设置存储：
 *  - **localStorage**（本域全量，含敏感键）：同源的 Feed（隔离世界，仅读）读同一份。不用 GM_setValue，保住 @grant none。
 *  - **`.bilibili.com` cookie**（非敏感设置的跨子域镜像）：localStorage 按子域隔离，www 配好在
 *    search / space 读不到；@grant none 下唯一的跨子域共享手段就是 domain=.bilibili.com 的 cookie。
 *    **敏感键（如 feed.accessKey 登录凭证）绝不进 cookie**——否则会随每个 *.bilibili.com 请求外发。
 */
const KEY = 'bilikit:settings'
const CK = 'bilikit_settings' // cookie 名（避免冒号）
export const SENSITIVE = /accessKey|token|secret|passwd|password/i // 不进跨子域 cookie 的键
// 本 Tab 内设置变更通知（同 Tab 的 storage 事件不触发）：模块可监听它即时响应面板改动
export const SETTINGS_EVENT = 'bilikit:settings-changed'
type Store = Record<string, unknown>

function readLocal(): Store {
  try { return (JSON.parse(localStorage.getItem(KEY) || '{}') as Store) ?? {} } catch { return {} }
}
function readCookie(): Store | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)bilikit_settings=([^;]*)/)
    if (!m || !m[1]) return null
    return JSON.parse(decodeURIComponent(m[1])) as Store
  } catch { return null }
}
// 只把非敏感键写进 cookie（纯函数，导出供单测——accessKey 泄漏进跨子域 cookie 是安全事故）
export function toCookieStore(s: Store): Store {
  const out: Store = {}
  for (const k in s) if (!SENSITIVE.test(k)) out[k] = s[k]
  return out
}
function writeCookie(s: Store): void {
  try {
    const v = encodeURIComponent(JSON.stringify(toCookieStore(s)))
    document.cookie = `${CK}=${v}; path=/; domain=.bilibili.com; max-age=31536000; SameSite=Lax`
  } catch { /* ignore */ }
}

// 合并后的设置缓存：get() 每次调用曾都重新读 localStorage + 解析 cookie（site-drawer 每次点击/mouseover
// 都调 get，profile 里 readCookie 占可观自耗时）。缓存一份，set() 就地更新、跨标签改动由 storage 事件失效。
let cache: Store | null = null
function load(): Store {
  if (cache) return cache
  // 跨子域 cookie（非敏感）覆盖本域，同时保留本域独有的敏感键（如 feed.accessKey）
  const local = readLocal()
  const c = readCookie()
  cache = c ? { ...local, ...c } : local
  return cache
}
// 别的标签页改了本域 localStorage → 失效重读（本标签自己 set 走 save 就地更新，不会触发本事件）
try { window.addEventListener('storage', (e) => { if (!e.key || e.key === KEY) cache = null }) } catch { /* ignore */ }

function save(s: Store): boolean {
  cache = s // 缓存随即反映本次写入（s 通常就是 load() 返回的同一对象）
  writeCookie(s) // 非敏感 → 跨子域共享
  try {
    localStorage.setItem(KEY, JSON.stringify(s)) // 本域全量（含敏感键，供 Feed 读）
    try { window.dispatchEvent(new Event(SETTINGS_EVENT)) } catch { /* 无 window/事件不可用时忽略 */ }
    return true
  } catch {
    return false // 隐私模式/超限：持久化失败，交由调用方决定是否提示
  }
}

/**
 * 启动时对齐两处存储：把跨子域 cookie 的设置并回本域 localStorage（供仅读 localStorage 的 Feed 读到同一份）；
 * 老用户若 cookie 尚空但本域已有设置，则反向种一次 cookie，让其它子域立刻拿到。仅顶层窗口调用一次即可。
 */
export function syncSharedSettings(): void {
  const c = readCookie()
  const local = readLocal()
  if (c) {
    try { localStorage.setItem(KEY, JSON.stringify({ ...local, ...c })) } catch { /* ignore */ }
  } else if (Object.keys(local).length) {
    writeCookie(local)
  }
}

export function get<T>(key: string, fallback: T): T {
  const s = load()
  return key in s ? (s[key] as T) : fallback
}

export function set(key: string, value: unknown): boolean {
  const s = load()
  s[key] = value
  return save(s) // 返回是否落盘成功（隐私模式/超限时为 false）
}

const enabledKey = (id: string) => `module.${id}.enabled`

export function isModuleEnabled(m: BiliKitModule): boolean {
  return get(enabledKey(m.id), m.defaultEnabled !== false)
}

export function setModuleEnabled(id: string, on: boolean): void {
  set(enabledKey(id), on)
}

/* ------------------------------------------------------------------ *
 * 模块配置项（供设置面板读写；缺省回落到 SettingField.default）
 * ------------------------------------------------------------------ */
const cfgKey = (id: string, key: string) => `module.${id}.cfg.${key}`

export function getField(m: BiliKitModule, key: string): unknown {
  const field = m.settings?.find((f) => f.key === key)
  return get(cfgKey(m.id, key), field ? field.default : undefined)
}

export function setField(id: string, key: string, value: unknown): boolean {
  return set(cfgKey(id, key), value)
}

/** 绑定到某模块的配置读取器，传给它的 init(cfg)。 */
export function makeCfg(m: BiliKitModule): Cfg {
  return {
    get: <T = any>(key: string) => getField(m, key) as T,
  }
}
