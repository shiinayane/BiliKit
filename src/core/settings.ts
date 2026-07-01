import type { BiliKitModule, Cfg } from './module'

/**
 * 设置存储：localStorage（同源共享 → 将来 BiliKit Feed 那个隔离世界脚本能读到同一份，
 * 达成「两个 .user.js、一套设置」的统一体验）。不使用 GM_setValue，以保住 @grant none。
 */
const KEY = 'bilikit:settings'
type Store = Record<string, unknown>

function load(): Store {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || '{}') as Store) ?? {}
  } catch {
    return {}
  }
}

function save(s: Store): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    return true
  } catch {
    return false // 隐私模式/超限：持久化失败，交由调用方决定是否提示
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
