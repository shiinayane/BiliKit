import { getModules, type BiliKitModule, type SettingField } from './module'
import { isModuleEnabled, setModuleEnabled, getField, setField } from './settings'

/**
 * 设置面板：左下悬浮齿轮 → 居中模态。整个 UI 挂在 Shadow DOM 里，样式与 B 站彻底隔离
 * （不被 B 站 CSS 污染，也不污染 B 站）。模块列表 + 每模块声明的配置项自动渲染成控件。
 * 只在顶层窗口挂（不进 Float 抽屉 iframe）。深浅色跟随系统。
 */
const PANEL_ID = 'bilikit-panel-root'
let dirty = false // 有改动 → 提示刷新（模块在 init 时读配置，改动需刷新生效）

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", sans-serif; }

.gear {
  position: fixed; left: 16px; bottom: 24px; z-index: 2147483500;
  width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(18,18,22,.92); color: #fff;
  box-shadow: 0 2px 12px rgba(0,0,0,.28);
  opacity: .5; transition: opacity .15s ease, transform .15s ease;
}
.gear:hover { opacity: 1; transform: translateY(-1px); }
.gear:active { transform: scale(.94); }
.gear svg { width: 19px; height: 19px; display: block; }

.overlay {
  position: fixed; inset: 0; z-index: 2147483501;
  background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; visibility: hidden; transition: opacity .18s ease, visibility 0s linear .18s;
}
.overlay.open { opacity: 1; visibility: visible; transition: opacity .18s ease; }

.card {
  width: min(440px, calc(100vw - 32px)); max-height: 80vh;
  display: flex; flex-direction: column;
  background: #1c1d22; color: #e3e5e7; border-radius: 16px;
  box-shadow: 0 12px 48px rgba(0,0,0,.5);
  transform: translateY(8px) scale(.98); transition: transform .18s ease;
}
.overlay.open .card { transform: none; }

.head { display: flex; align-items: center; gap: 8px; padding: 16px 18px 12px; }
.head .title { font-size: 15px; font-weight: 600; }
.head .brand { color: #fb7299; }
.head .close { margin-left: auto; cursor: pointer; opacity: .6; font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 8px; }
.head .close:hover { opacity: 1; background: rgba(255,255,255,.08); }

.body { overflow: auto; padding: 4px 18px 8px; }

.mod { padding: 12px 0; border-top: 1px solid rgba(255,255,255,.07); }
.mod:first-child { border-top: none; }
.mod-head { display: flex; align-items: center; gap: 10px; }
.mod-name { font-size: 14px; font-weight: 500; }
.mod-desc { font-size: 12px; color: rgba(255,255,255,.45); margin-top: 2px; }
.mod-main { flex: 1; min-width: 0; }

.sw { position: relative; flex: 0 0 auto; width: 40px; height: 22px; }
.sw input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.sw .track { position: absolute; inset: 0; border-radius: 22px; background: rgba(255,255,255,.18); transition: background .15s ease; }
.sw .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
.sw input:checked + .track { background: #fb7299; }
.sw input:checked + .track::after { transform: translateX(18px); }

.fields { margin-top: 10px; padding-left: 2px; display: flex; flex-direction: column; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field.row { flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; }
.field label { font-size: 12px; color: rgba(255,255,255,.75); }
.field .hint { font-size: 11px; color: rgba(255,255,255,.4); }
.field input[type=text], .field textarea, .field select {
  width: 100%; background: rgba(255,255,255,.06); color: #e3e5e7;
  border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 6px 8px;
  font-size: 12px; font-family: inherit;
}
.field.row input[type=text], .field.row select { width: 160px; flex: 0 0 auto; }
.field textarea { min-height: 56px; resize: vertical; }

.foot { padding: 10px 18px 14px; font-size: 11px; color: rgba(255,255,255,.4); display: flex; align-items: center; gap: 10px; }
.reload { display: none; margin-left: auto; cursor: pointer; color: #fff; background: #fb7299; border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-family: inherit; }
.foot.dirty .reload { display: inline-block; }
.foot.dirty .note { color: #fb7299; }

@media (prefers-color-scheme: light) {
  .gear { background: rgba(255,255,255,.95); color: #18191c; border-color: rgba(0,0,0,.08); box-shadow: 0 2px 12px rgba(0,0,0,.14); }
  .card { background: #fff; color: #18191c; box-shadow: 0 12px 48px rgba(0,0,0,.22); }
  .head .brand { color: #d6336c; }
  .head .close:hover { background: rgba(0,0,0,.06); }
  .mod { border-top-color: rgba(0,0,0,.08); }
  .mod-desc { color: rgba(0,0,0,.45); }
  .sw .track { background: rgba(0,0,0,.18); }
  .sw input:checked + .track { background: #d6336c; }
  .field label { color: rgba(0,0,0,.7); }
  .field .hint { color: rgba(0,0,0,.42); }
  .field input[type=text], .field textarea, .field select { background: rgba(0,0,0,.04); color: #18191c; border-color: rgba(0,0,0,.14); }
  .foot { color: rgba(0,0,0,.45); }
  .reload { background: #d6336c; }
  .foot.dirty .note { color: #d6336c; }
}
`

const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`

function markDirty(foot: HTMLElement): void {
  dirty = true
  foot.classList.add('dirty')
}

function renderField(m: BiliKitModule, f: SettingField, foot: HTMLElement): HTMLElement {
  const wrap = document.createElement('div')
  const cur = getField(m, f.key)

  if (f.type === 'toggle') {
    wrap.className = 'field row'
    const lab = document.createElement('label')
    lab.textContent = f.label
    const sw = switchEl(!!cur, (on) => { setField(m.id, f.key, on); markDirty(foot) })
    wrap.append(lab, sw)
  } else if (f.type === 'select') {
    wrap.className = 'field row'
    const lab = document.createElement('label')
    lab.textContent = f.label
    const sel = document.createElement('select')
    for (const o of f.options) {
      const opt = document.createElement('option')
      opt.value = o.value
      opt.textContent = o.label
      if (o.value === cur) opt.selected = true
      sel.appendChild(opt)
    }
    sel.addEventListener('change', () => { setField(m.id, f.key, sel.value); markDirty(foot) })
    wrap.append(lab, sel)
  } else if (f.type === 'textarea') {
    wrap.className = 'field'
    const lab = document.createElement('label')
    lab.textContent = f.label
    const ta = document.createElement('textarea')
    ta.value = String(cur ?? '')
    if (f.placeholder) ta.placeholder = f.placeholder
    ta.addEventListener('change', () => { setField(m.id, f.key, ta.value); markDirty(foot) })
    wrap.append(lab, ta)
  } else {
    wrap.className = 'field'
    const lab = document.createElement('label')
    lab.textContent = f.label
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.value = String(cur ?? '')
    if (f.placeholder) inp.placeholder = f.placeholder
    inp.addEventListener('change', () => { setField(m.id, f.key, inp.value); markDirty(foot) })
    wrap.append(lab, inp)
  }

  if (f.hint) {
    const hint = document.createElement('div')
    hint.className = 'hint'
    hint.textContent = f.hint
    wrap.appendChild(hint)
  }
  return wrap
}

function switchEl(checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const sw = document.createElement('span')
  sw.className = 'sw'
  const inp = document.createElement('input')
  inp.type = 'checkbox'
  inp.checked = checked
  const track = document.createElement('span')
  track.className = 'track'
  inp.addEventListener('change', () => onChange(inp.checked))
  sw.append(inp, track)
  return sw
}

function renderBody(body: HTMLElement, foot: HTMLElement): void {
  body.textContent = ''
  for (const m of getModules()) {
    const enabled = isModuleEnabled(m)
    const mod = document.createElement('div')
    mod.className = 'mod'

    const headRow = document.createElement('div')
    headRow.className = 'mod-head'
    const main = document.createElement('div')
    main.className = 'mod-main'
    const name = document.createElement('div')
    name.className = 'mod-name'
    name.textContent = m.name
    main.appendChild(name)
    if (m.description) {
      const desc = document.createElement('div')
      desc.className = 'mod-desc'
      desc.textContent = m.description
      main.appendChild(desc)
    }
    const sw = switchEl(enabled, (on) => {
      setModuleEnabled(m.id, on)
      markDirty(foot)
      renderBody(body, foot) // 重渲染：启用后露出该模块的配置项，禁用则收起
    })
    headRow.append(main, sw)
    mod.appendChild(headRow)

    // 仅在启用且有配置项时渲染控件
    if (enabled && m.settings && m.settings.length) {
      const fields = document.createElement('div')
      fields.className = 'fields'
      for (const f of m.settings) fields.appendChild(renderField(m, f, foot))
      mod.appendChild(fields)
    }
    body.appendChild(mod)
  }
}

export function mountPanel(): void {
  if (window.top !== window.self) return // 不进 iframe
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', mountPanel, { once: true })
    return
  }
  if (document.getElementById(PANEL_ID)) return

  const root = document.createElement('div')
  root.id = PANEL_ID
  const sr = root.attachShadow({ mode: 'open' })
  sr.innerHTML = `<style>${STYLE}</style>`

  const gear = document.createElement('div')
  gear.className = 'gear'
  gear.title = 'BiliKit 设置'
  gear.innerHTML = GEAR_SVG

  const overlay = document.createElement('div')
  overlay.className = 'overlay'
  const card = document.createElement('div')
  card.className = 'card'

  const head = document.createElement('div')
  head.className = 'head'
  head.innerHTML = `<span class="title"><span class="brand">BiliKit</span> 设置</span>`
  const close = document.createElement('span')
  close.className = 'close'
  close.textContent = '×'
  head.appendChild(close)

  const body = document.createElement('div')
  body.className = 'body'

  const foot = document.createElement('div')
  foot.className = 'foot'
  const note = document.createElement('span')
  note.className = 'note'
  note.textContent = '开关与配置改动需刷新页面生效'
  const reload = document.createElement('button')
  reload.className = 'reload'
  reload.textContent = '刷新'
  reload.addEventListener('click', () => location.reload())
  foot.append(note, reload)

  card.append(head, body, foot)
  overlay.appendChild(card)

  const open = () => { renderBody(body, foot); overlay.classList.add('open') }
  const closePanel = () => overlay.classList.remove('open')
  gear.addEventListener('click', open)
  close.addEventListener('click', closePanel)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel() })

  sr.append(gear, overlay)
  document.body.appendChild(root)
}
