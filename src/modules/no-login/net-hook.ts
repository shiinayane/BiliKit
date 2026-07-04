/**
 * 袖珍 fetch / XHR 拦截器——只服务 no-login 模块的固定几个接口，对其余请求**原样透传**。
 * 能力：按 URL 片段匹配 → 改请求(url / credentials) / 改响应(解析 JSON → 变形 → 回填)。
 * 覆盖 fetch 与 XHR 两条路（B 站 nav/reply 走 fetch、playurl/player 走 XHR）。
 *
 * 设计取舍：
 *  - 只处理 **GET** 接口（本模块用到的全是 GET），改请求时把 Request 归一成 (url, init)，不搬 body。
 *  - XHR 用 `class X extends OX` + 重写 responseText/response getter，与 cdn-pick 同一套（本仓库验证过）。
 *  - 与 cdn-pick 并存：非匹配 URL 一律 `apply` 原链，两个 Core hook 经 register() 定序、不抢。
 */

export interface NetRule {
  /** URL 命中判定 */
  match: (url: string) => boolean
  /** 改请求：返回新 url / credentials（都可选，不返回则不改） */
  rewriteRequest?: (url: string) => { url?: string; credentials?: RequestCredentials } | undefined
  /** 改响应：拿到解析后的 JSON，返回变形后的对象（原地改或换新都行） */
  rewriteResponse?: (json: any, url: string) => any
}

const urlOf = (input: any): string => {
  if (typeof input === 'string') return input
  if (input && typeof input.url === 'string') return input.url // Request
  try { return String(input) } catch { return '' }
}

// 把 Request 归一成 init（仅搬 GET 安全字段：method/headers/credentials/signal；不搬 body。
// 不搬 mode——'navigate' 传给 fetch(url, {mode:'navigate'}) 会抛 TypeError，且本模块只改 GET API，默认 mode 即可）
function requestToInit(req: Request): RequestInit {
  const headers: Record<string, string> = {}
  try { req.headers.forEach((v, k) => { headers[k] = v }) } catch { /* ignore */ }
  return { method: req.method, headers, credentials: req.credentials, referrer: req.referrer, signal: req.signal }
}

export function installNetHook(rules: NetRule[]): void {
  if ((window as any).__BILIKIT_NET_HOOK__) return // 幂等：同一 window 只包一次，杜绝二次包裹致响应被改两遍
  ;(window as any).__BILIKIT_NET_HOOK__ = true

  // 一、fetch
  const origFetch = window.fetch
  if (origFetch) {
    window.fetch = async function (input: any, init?: any) {
      const url = urlOf(input)
      const rule = rules.find((r) => r.match(url))
      if (!rule) return origFetch.apply(this, arguments as any)

      let realInput: any = input
      let realInit: any = init
      const rw = rule.rewriteRequest?.(url)
      if (rw && (rw.url || rw.credentials)) {
        if (input instanceof Request && !rw.url) {
          // 仅改 credentials（如 reply 走匿名）：用 Request 克隆构造，headers/body/signal/mode 原样保留、只覆盖 credentials
          realInput = new Request(input, rw.credentials ? { credentials: rw.credentials } : {})
          realInit = init
        } else {
          // 改了 url：归一成字符串 url + init（Request 的 body 仅 GET 接口，按设计不搬）
          const base = input instanceof Request ? requestToInit(input) : (init || {})
          realInput = rw.url || url
          realInit = { ...base, ...(rw.credentials ? { credentials: rw.credentials } : {}) }
        }
      }
      const resp = await origFetch.call(this, realInput, realInit)
      if (!rule.rewriteResponse) return resp
      try {
        const text = await resp.clone().text()
        const out = rule.rewriteResponse(JSON.parse(text), url)
        const headers = new Headers(resp.headers)
        headers.delete('content-length') // 正文已解码、长度变了
        headers.delete('content-encoding') // 已不是原编码
        return new Response(JSON.stringify(out), { status: resp.status, statusText: resp.statusText, headers })
      } catch { return resp } // 非 JSON / 解析失败 → 原样返回
    } as any
  }

  // 二、XHR
  const OX = window.XMLHttpRequest
  if (OX) {
    class X extends OX {
      private __nlUrl = ''
      private __nlRule: NetRule | undefined
      private __nlRw: { url?: string; credentials?: RequestCredentials } | undefined
      open(method: any, url: any, ...rest: any[]) {
        this.__nlUrl = String(url)
        this.__nlRule = rules.find((r) => r.match(this.__nlUrl))
        // rewriteRequest 只算一次（playurl 会重签 wbi，二次调用会用不同 wts 得到不同 w_rid）；结果挂实例供 send 复用
        this.__nlRw = this.__nlRule?.rewriteRequest?.(this.__nlUrl)
        return super.open(method, this.__nlRw?.url || url, ...(rest as [any, any, any]))
      }
      send(body?: any) {
        const c = this.__nlRw?.credentials
        if (c === 'omit') this.withCredentials = false // 跨源不带 cookie = 匿名
        else if (c) this.withCredentials = true
        return super.send(body)
      }
      get responseText(): string {
        const rt = this.responseType
        if (rt !== '' && rt !== 'text') return super.responseText // 非文本型：交回原生（读它本就抛 InvalidStateError，语义一致），别再解析
        const raw = super.responseText
        if (this.readyState === 4 && this.__nlRule?.rewriteResponse && typeof raw === 'string') {
          try { return JSON.stringify(this.__nlRule.rewriteResponse(JSON.parse(raw), this.__nlUrl)) } catch { return raw }
        }
        return raw
      }
      get response(): any {
        const raw = super.response
        if (this.readyState === 4 && this.__nlRule?.rewriteResponse) {
          if (typeof raw === 'string') { try { return JSON.stringify(this.__nlRule.rewriteResponse(JSON.parse(raw), this.__nlUrl)) } catch { return raw } }
          if (raw && typeof raw === 'object') { try { return this.__nlRule.rewriteResponse(raw, this.__nlUrl) } catch { return raw } }
        }
        return raw
      }
    }
    window.XMLHttpRequest = X as any
  }
}
