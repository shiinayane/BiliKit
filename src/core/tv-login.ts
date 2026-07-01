import qrcode from 'qrcode-generator'
import { signAppQuery } from '../lib/app-sign'

/**
 * TV 端扫码登录取 access_key —— 跑在 Core 的「页面世界」（@grant none），用**普通 fetch +
 * credentials:'include'**（带登录 cookie、正常浏览器指纹）打 passport。
 * 关键：passport 允许带凭据的 CORS，且正常浏览器请求过 SEC 风控；用 GM 后台请求会被 SEC 412
 * （详见 docs 与实测）。这也是 Bilibili-Gate 的做法（它用 `request` 而非 `gmrequest`）。
 * 成功后把 access_token 交给 onSuccess（面板存进 bilikit:settings 的 feed.accessKey）。
 */
const PASSPORT = 'https://passport.bilibili.com'

async function postSigned(path: string, params: Record<string, string>): Promise<any> {
  const ts = String(Math.floor(Date.now() / 1000))
  const body = signAppQuery({ ...params, local_id: '0', ts })
  const res = await fetch(PASSPORT + path, {
    method: 'POST',
    credentials: 'include', // 带 web 登录 cookie → SEC 视为可信会话
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return res.json()
}

/* ------------------------------------------------------------------ *
 * 浮层 UI（Shadow DOM 隔离，深色卡 + B站粉，跟 BiliKit 一套视觉）
 * ------------------------------------------------------------------ */
let root: HTMLElement | null = null
let qrImg: HTMLImageElement | null = null
let statusEl: HTMLElement | null = null
let running = false

function closeOverlay(): void {
  if (root) root.remove()
  root = qrImg = statusEl = null
}

function openOverlay(): void {
  closeOverlay()
  root = document.createElement('div')
  const sr = root.attachShadow({ mode: 'open' })
  sr.innerHTML = `<style>
    :host{ all:initial }
    .ov{ position:fixed; inset:0; z-index:2147483600; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      font-family:-apple-system,"PingFang SC",sans-serif; -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px); }
    .card{ width:300px; background:#1c1d22; color:#e3e5e7; border-radius:16px; padding:22px; text-align:center;
      box-shadow:0 16px 56px rgba(0,0,0,.5); }
    .title{ font-size:15px; font-weight:600; margin-bottom:4px } .title b{ color:#fb7299 }
    .hint{ font-size:12px; color:rgba(255,255,255,.45); margin-bottom:16px }
    .qr{ width:200px; height:200px; background:#fff; border-radius:10px; margin:0 auto; display:flex; align-items:center; justify-content:center; overflow:hidden }
    .qr img{ width:184px; height:184px; display:block }
    .status{ font-size:13px; color:rgba(255,255,255,.75); margin-top:16px; min-height:18px }
    .close{ margin-top:14px; cursor:pointer; color:rgba(255,255,255,.5); font-size:12px }
    .close:hover{ color:#fff }
    @media (prefers-color-scheme: light){
      .card{ background:#fff; color:#18191c; box-shadow:0 16px 56px rgba(0,0,0,.22) }
      .title b{ color:#d6336c } .hint{ color:rgba(0,0,0,.45) } .status{ color:rgba(0,0,0,.7) }
      .close{ color:rgba(0,0,0,.45) } .close:hover{ color:#000 }
    }
  </style>
  <div class="ov"><div class="card">
    <div class="title"><b>BiliKit</b> · 登录 App 推荐</div>
    <div class="hint">用手机哔哩哔哩 App 扫码</div>
    <div class="qr"><img alt=""></div>
    <div class="status">正在获取二维码…</div>
    <div class="close">取消</div>
  </div></div>`
  qrImg = sr.querySelector('img')
  statusEl = sr.querySelector('.status')
  sr.querySelector('.close')!.addEventListener('click', closeOverlay)
  sr.querySelector('.ov')!.addEventListener('click', (e) => { if ((e.target as HTMLElement).classList.contains('ov')) closeOverlay() })
  document.body.appendChild(root)
}

function setStatus(t: string): void { if (statusEl) statusEl.textContent = t }
function renderQR(url: string): void {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  if (qrImg) qrImg.src = qr.createDataURL(6, 8)
  setStatus('等待扫码…')
}

/** 启动扫码登录。成功时用拿到的 access_key 调 onSuccess。 */
export function startTvLogin(onSuccess: (accessKey: string) => void): void {
  if (running || window.top !== window.self) return
  running = true
  openOverlay()
  ;(async () => {
    try {
      const auth = await postSigned('/x/passport-tv-login/qrcode/auth_code', {})
      if (auth.code !== 0 || !auth.data) { setStatus(`获取二维码失败：${auth.code} ${auth.message || ''}`); running = false; return }
      const { url, auth_code } = auth.data
      renderQR(url)
      const started = Date.now()
      const timer = setInterval(async () => {
        if (!root) { clearInterval(timer); running = false; return } // 用户关了
        if (Date.now() - started > 180000) { clearInterval(timer); running = false; setStatus('二维码已过期，请重新登录'); return }
        try {
          const poll = await postSigned('/x/passport-tv-login/qrcode/poll', { auth_code })
          if (poll.code === 0 && poll.data && poll.data.access_token) {
            clearInterval(timer); running = false
            onSuccess(poll.data.access_token)
            setStatus('登录成功，即将刷新…')
            setTimeout(() => { closeOverlay(); location.reload() }, 1000)
          } else if (poll.code === 86038) { clearInterval(timer); running = false; setStatus('二维码已失效，请重新登录') } else if (poll.code === 86090) { setStatus('已扫码，请在手机上确认') }
          // 86039 = 未扫码，继续等
        } catch (_) { /* 单次轮询失败忽略 */ }
      }, 2000)
    } catch (e) {
      setStatus('登录出错：' + (e as Error).message)
      running = false
    }
  })()
}
