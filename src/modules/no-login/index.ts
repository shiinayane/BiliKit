import type { BiliKitModule, Cfg } from '../../core/module'
import { installNetHook, type NetRule } from './net-hook'
import { signQuery, warmKeys } from './wbi-core'

/**
 * 免登录：未登录也能看评论 / 他人动态 / 1080p 视频——装它即可卸载 beefreely 等第三方脚本，
 * 从根上消掉「两个脚本抢 fetch/XHR」的竞态（issue #2）。做法逆向自 beefreely（详见 docs/RESEARCH-no-login.md）：
 *  - 伪造 DedeUserID cookie 让页面「以为」已登录；
 *  - nav 响应合并成已登录（保留 wbi_img）→ 登录态 UI + 动态可见；
 *  - reply 请求走匿名(credentials:'omit') → 放行公开评论；
 *  - playurl 塞 qn=80+try_look=1 重签 wbi + 置空预埋 __playinfo__ → 1080p；player/wbi/v2 改字段让 UI 认账。
 *
 * 侵入性 → 默认关，用户显式开启。仅「未登录」时生效：检测到已登录立即整体不启用，绝不干扰真登录。
 * 纯只读观看：任何要真鉴权的动作（发评论/点赞/投币/历史同步）都会失败；1080p 上限为 try_look（大会员专享清晰度拿不到）。
 */
// 需要「真登录」的个人数据页：伪造登录会让它们拿假身份取不到数据、前后端状态打架 → 反复重刷。
// 这些页免登录一律不碰（收藏/历史/稍后看/清单/消息/账号/会员中心等）。
const AUTH_HOSTS = ['message.bilibili.com', 'account.bilibili.com', 'member.bilibili.com', 'pay.bilibili.com', 'big.bilibili.com']
const AUTH_PATHS = ['/history', '/watchlater', '/favlist', '/medialist', '/account', '/pincenter']
function needsRealLogin(): boolean {
  if (AUTH_HOSTS.includes(location.hostname)) return true
  return AUTH_PATHS.some((p) => location.pathname.includes(p))
}
// 清掉本模块之前在别处（视频/首页）种下的假 DedeUserID（此时必无真登录 ckMd5，故任何 DedeUserID 都是假的）
function clearFakeUid(): void {
  try { if (/DedeUserID=/.test(document.cookie)) document.cookie = 'DedeUserID=; path=/; domain=.bilibili.com; max-age=0' } catch { /* ignore */ }
}

function init(_cfg: Cfg): void {
  if ((window as any).__BILIKIT_NO_LOGIN__) return
  // 顶层窗口总是生效；iframe 仅限我们自己的抽屉（bk-drawer 标记）——好让 Feed 抽屉里看视频也享免登录 1080p/评论。
  // 假 DedeUserID cookie 是 domain=.bilibili.com、顶层已种，抽屉 iframe 同域天然共享，无需重种。
  if (window.top !== window.self && !location.hash.includes('bk-drawer')) return
  if (location.hostname === 'passport.bilibili.com') return // 登录页不碰
  if (/DedeUserID__ckMd5=/.test(document.cookie)) return // 已登录 → 整体不启用
  // 个人数据页：不伪造，并清掉别处种下的假 cookie，让页面按未登录干净处理（跳登录/空列表），不重刷
  if (needsRealLogin()) { clearFakeUid(); return }
  ;(window as any).__BILIKIT_NO_LOGIN__ = true

  // 1) 伪造 DedeUserID cookie → 页面按登录态渲染（评论区/动态/播放器）
  if (!/DedeUserID=/.test(document.cookie)) {
    try { document.cookie = `DedeUserID=${Math.floor(Math.random() * 2 ** 50)}; path=/; domain=.bilibili.com` } catch { /* ignore */ }
  }

  // 1.5) 收拾伪造登录的副作用：个别带假 cookie 的请求被服务端判 -101 → 打开视频瞬间闪一个红色
  //      「账号未登录」toast（Vant 的 .van-message-error，一闪即逝）。CSS 藏掉，眼不见。
  //      仅在免登录开启时注入，不影响真登录/未启用免登录的用户的正常错误提示。
  try {
    const st = document.createElement('style')
    st.textContent = '.van-message.van-message-error{display:none!important}'
    ;(document.head || document.documentElement).appendChild(st)
  } catch { /* ignore */ }

  // 2) 置空页面预埋的低清 __playinfo__（吞掉 SSR 赋值）→ 逼播放器重新请求 playurl，好让下面升到 1080p。
  //    注册在 cdn-pick 之后 → 本定义覆盖 cdn-pick 的 __playinfo__ setter（其 SSR 首帧换 host 那条随之失效）；
  //    但播放器**重新请求**的 playurl 仍会过 cdn-pick 的 fetch/XHR hook 换 host，故 CDN 优选对真正的取流不丢。
  try {
    Object.defineProperty(window, '__playinfo__', { configurable: true, get: () => null, set: () => { /* 丢弃低清 SSR 数据 */ } })
  } catch { /* ignore */ }

  // 捕获未被本模块包裹的 fetch，供 wbi 取 key 兜底（打 nav 时不经自身 rewrite）
  const pureFetch = window.fetch.bind(window)
  warmKeys(pureFetch)

  // 假的「已登录」用户字段：合并到真实 nav.data 上，保留 wbi_img 等原字段不动
  const MID = Math.floor(Math.random() * 1e15)
  const MOCK_USER = {
    isLogin: true,
    is_login: true,
    mid: MID,
    uname: 'bilibili',
    face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
    email_verified: 1,
    mobile_verified: 1,
    money: 0,
    moral: 70,
    level_info: { current_level: 6, current_min: 28800, current_exp: 29050, next_exp: '--' },
    official: { role: 0, title: '', desc: '', type: -1 },
    officialVerify: { type: -1, desc: '' },
    vipStatus: 0,
    vipType: 0,
  }

  const rules: NetRule[] = [
    // nav：合并成「已登录」，保留 wbi_img 等原字段（→ 登录态 UI + 动态可见）
    {
      match: (u) => u.includes('/x/web-interface/nav'),
      rewriteResponse: (j) => {
        try {
          if (j?.data?.isLogin) return j // 真已登录不动
          j.code = 0
          j.message = '0'
          j.data = Object.assign({}, j.data, MOCK_USER)
        } catch { /* ignore */ }
        return j
      },
    },
    // reply：匿名请求（假 cookie 会被拒，去掉反而正常返公开评论）→ 视频/动态下方评论
    {
      match: (u) => u.includes('/x/v2/reply/wbi/main') || u.includes('/x/v2/reply/reply'),
      rewriteRequest: () => ({ credentials: 'omit' }),
    },
    // player/wbi/v2：改 login_mid / 等级 / 字幕字段 → 播放器 UI 认账（清晰度、字幕可选）
    {
      match: (u) => u.includes('/x/player/wbi/v2'),
      rewriteResponse: (j) => {
        try {
          const d = j?.data
          if (d) {
            d.login_mid = MID
            d.need_login_subtitle = false
            if (d.level_info) d.level_info.current_level = 6
          }
        } catch { /* ignore */ }
        return j
      },
    },
    // playurl：塞 qn=80(1080p) + try_look=1(试看)、去掉旧签名重签 wbi → 1080p 取流
    {
      match: (u) => u.includes('/x/player/wbi/playurl'),
      rewriteRequest: (u) => {
        try {
          const [base, qs = ''] = u.split('?')
          const params: Record<string, string> = Object.fromEntries(new URLSearchParams(qs))
          delete params.w_rid
          delete params.wts
          params.qn = '80'
          params.try_look = '1'
          const signed = signQuery(params)
          if (!signed) return // 拿不到 wbi key → 维持原请求，不强改（下次导航 key 就绪再升）
          return { url: `${base}?${signed}` }
        } catch { return }
      },
    },
  ]
  installNetHook(rules)
}

export const noLogin: BiliKitModule = {
  id: 'no-login',
  name: '免登录',
  description: '未登录也能看评论 / 他人动态 / 1080p（装它即可替代 beefreely，避免脚本冲突）',
  note:
    '开启后未登录也能：看视频/动态下方<b>评论</b>、看他人<b>动态</b>、看 <b>1080p</b> 视频。装了它就能卸载 beefreely 等免登录脚本，避免多个脚本抢改请求导致的时好时坏。<br>' +
    '<b>取舍（务必知悉）</b>：' +
    '① 纯<b>只读</b>——页面「以为」你已登录（显示假账号），但发评论/点赞/投币/收藏/历史同步等需真鉴权的操作都会失败；' +
    '② <b>看不到评论 IP 属地</b>——评论走匿名请求，B 站服务端只对真登录返回属地字段，免登录下拿不到（与「评论属地」模块不可兼得）；' +
    '③ 1080p 上限为官方<b>试看</b>，4K/HDR/大会员专享清晰度仍拿不到；' +
    '④ 仅<b>未登录</b>时生效，检测到已登录会自动让路、不干扰真账号。',
  category: '增强',
  defaultEnabled: false, // 侵入性功能，默认关
  runAt: 'start',
  init,
}
