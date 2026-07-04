import type { BiliKitModule, Cfg } from '../../core/module'
import { installNetHook, type NetRule } from './net-hook'
import { signQuery, warmKeys } from './wbi-core'
import { playurlParams } from './playurl'

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
  // 2.5) 新版播放器读的是 playurlSSRData 而非 __playinfo__：抢先声明 const 全局词法绑定 →
  //      页面后续的 SSR 内联赋值报错被吞、播放器裸引用只能拿到我们的空对象 → 同样逼它重新请求 playurl。
  //      （照抄 beefreely core/config.ts 的 www action；少了它，新版播放器首帧仍会用 SSR 低清流。）
  try {
    const sc = document.createElement('script')
    sc.textContent = 'const playurlSSRData = {}'
    ;(document.head || document.documentElement).appendChild(sc)
    sc.remove()
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

  // space/v2/myinfo 的假「本人资料」：空间页登录后必打此接口，假 cookie 下必返 -101，
  // 空间前端见「cookie 已登录 + myinfo 未登录」即判会话失效而 location.reload → 死循环。
  // 形状整体照抄 beefreely（space/model/constants.ts，对空间前端 known-good），mid 与 MOCK_USER 同一 MID——
  // 「是否本人空间」按 mid 对比，假 mid ≠ 页面 UP mid → 一律按访客视角渲染，正好是我们要的只读浏览。
  const MOCK_MYINFO = {
    profile: {
      mid: MID, name: 'bilibili', sex: '保密', face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg', sign: '',
      rank: 10000, level: 6, jointime: 0, moral: 70, silence: 0, email_status: 0, tel_status: 1, identification: 0,
      vip: { type: 0, status: 0, due_date: 0, vip_pay_type: 0, theme_type: 0,
        label: { path: '', text: '', label_theme: '', text_color: '', bg_style: 0, bg_color: '', border_color: '', use_img_label: true, img_label_uri_hans: '', img_label_uri_hant: '', img_label_uri_hans_static: '', img_label_uri_hant_static: '', label_id: 0, label_goto: null },
        avatar_subscript: 0, nickname_color: '', role: 0, avatar_subscript_url: '', tv_vip_status: 0, tv_vip_pay_type: 0, tv_due_date: 0,
        avatar_icon: { icon_resource: {} }, ott_info: { vip_type: 0, pay_type: 0, pay_channel_id: '', status: 0, overdue_time: 0 }, super_vip: { is_super_vip: false } },
      pendant: { pid: 0, name: '', image: '', expire: 0, image_enhance: '', image_enhance_frame: '', n_pid: 0 },
      nameplate: { nid: 0, name: '', image: '', image_small: '', level: '', condition: '' },
      official: { role: 0, title: '', desc: '', type: -1 },
      birthday: 315504000, is_tourist: 0, is_fake_account: 0, pin_prompting: 0, is_deleted: 0, in_reg_audit: 0, is_rip_user: false,
      profession: { id: 0, name: '', show_name: '', is_show: 0, category_one: '', realname: '', title: '', department: '', certificate_no: '', certificate_show: false },
      face_nft: 0, face_nft_new: 0, is_senior_member: 0,
      honours: { mid: MID, colour: { dark: '#CE8620', normal: '#F0900B' }, tags: null, is_latest_100honour: 0 },
      digital_id: '', digital_type: -2,
      attestation: { type: 0, common_info: { title: '', prefix: '', prefix_title: '' }, splice_info: { title: '' }, icon: '', desc: '' },
      expert_info: { title: '', state: 0, type: 0, desc: '' }, name_render: null, country_code: '86', handle: '',
    },
    level_exp: { current_level: 6, current_min: 28800, current_exp: 29050, next_exp: '--' },
    coins: 0, following: 0, follower: 0,
  }

  const rules: NetRule[] = [
    // space/v2/myinfo：伪造成功响应压掉空间页「会话失效 → 自刷」路径（真登录成功不动）
    {
      match: (u) => u.includes('/x/space/v2/myinfo'),
      rewriteResponse: (j) => {
        try { if (j?.code === 0 && j?.data?.profile) return j } catch { /* ignore */ }
        return { code: 0, message: '0', ttl: 1, data: MOCK_MYINFO }
      },
    },
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
    // relation：与 UP 的关注关系——假 cookie 下真接口返 -101 → 关注按钮/粉丝数报错、
    // 视频页红 toast 的源头之一。mock 成「无关注关系」（照抄 beefreely useRelation）。
    // 注意 match 写全 'web-interface/relation?'：别误吞 archive/relation（下一条单独管）。
    {
      match: (u) => u.includes('/x/web-interface/relation?'),
      rewriteResponse: (j) => {
        try { if (j?.code === 0 && j?.data) return j } catch { /* ignore */ }
        return { code: 0, message: '0', ttl: 1, data: {
          relation: { mid: 0, attribute: 0, mtime: 0, tag: null, special: 0 },
          be_relation: { mid: 0, attribute: 0, mtime: 0, tag: null, special: 0 },
        } }
      },
    },
    // archive/relation：与本视频的互动状态（点赞/投币/收藏）——同样返 -101 触发未登录提示。
    // mock 成「均未互动」（照抄 beefreely useArchiveRelation）。
    {
      match: (u) => u.includes('/x/web-interface/archive/relation'),
      rewriteResponse: (j) => {
        try { if (j?.code === 0 && j?.data) return j } catch { /* ignore */ }
        return { code: 0, message: '0', ttl: 1, data: {
          attention: false, favorite: false, season_fav: false, like: false, dislike: false, coin: 0,
        } }
      },
    },
    // 搜索页热搜接口拼接损坏（B 站自身 bug，只在未登录时出现）：api.bilibili.comx/... 少了个 /
    // → 404、热搜/搜索结果拿不到。补上斜杠（照抄 beefreely useSearch）。
    {
      match: (u) => u.includes('/api.bilibili.comx/web-interface/search'),
      rewriteRequest: (u) => ({ url: u.replace(/\.com(?!\/)/, '.com/') }),
    },
    // 番剧/PGC（ogv/player/playview）：把 user_status.is_login 掰成 true → 播放器不再弹
    // 「登录后观看」、清晰度不锁最低。PGC 无需重签 playurl，is_login 即全部机制（beefreely 同）。
    {
      match: (u) => u.includes('/ogv/player/playview'),
      rewriteResponse: (j) => {
        try { if (j?.data?.user_status) j.data.user_status.is_login = true } catch { /* ignore */ }
        return j
      },
    },
    // playurl：塞 qn=80(1080p) + try_look=1(试看)、去掉旧签名重签 wbi → 1080p 取流。
    // iPad/移动 Safari 触发 B 站触屏判定 → 播放器发 platform=html5(MP4)，服务端对 html5 的免登录
    // 试看只给到 480p，qn=80 也被打回。故强行掰回桌面 DASH 路径：platform=pc + fnval=4048(全 DASH)
    // + fourk=1，让服务端按桌面策略放行 1080p 试看（桌面本就这套，零风险；iPad 靠 MSE 放 DASH）。
    {
      match: (u) => u.includes('/x/player/wbi/playurl'),
      rewriteRequest: (u) => {
        try {
          const { base, params } = playurlParams(u) // 纯参数改写在 ./playurl
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
