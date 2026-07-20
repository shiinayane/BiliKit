import { describe, expect, it } from 'vitest'
import {
  DRAWER_MARK,
  DRAWER_WEB_MARK,
  drawerDisplayUrl,
  drawerFrameName,
  drawerMark,
  readDrawerFrameName,
  readDrawerOrigin,
  readDrawerRoute,
  safeDrawerVideoUrl,
  withDrawerOrigin,
  withDrawerRoute,
  type DrawerHistoryRoute,
} from './drawer-history'

const route: DrawerHistoryRoute = {
  token: 'test-token-123',
  url: 'https://www.bilibili.com/video/BV1xx',
  cover: 'cover.jpg',
  webFull: false,
  immersive: false,
}

describe('drawer history', () => {
  it('同源时用视频 URL 同步地址栏并去掉内部标记', () => {
    expect(drawerDisplayUrl(
      'https://www.bilibili.com/video/BV1xx#bk-drawer-web',
      'https://www.bilibili.com/',
    )).toBe('https://www.bilibili.com/video/BV1xx')
  })

  it('跨子域时不伪造无法刷新的地址', () => {
    expect(drawerDisplayUrl(
      'https://www.bilibili.com/video/BV1xx',
      'https://search.bilibili.com/all?keyword=test',
    )).toBeNull()
  })

  it('保留站点已有 state 并能读回抽屉路由', () => {
    const state = withDrawerRoute({ site: 'home' }, route)
    expect(state.site).toBe('home')
    expect(readDrawerRoute(state)).toEqual(route)
    expect(readDrawerRoute({ __bilikitDrawer: { url: route.url } })).toBeNull()
  })

  it('origin 与 drawer marker 互斥，关闭时可准确识别锚点', () => {
    const origin = withDrawerOrigin({ site: 'home', __bilikitDrawer: route }, route.token)
    expect(readDrawerOrigin(origin)).toBe(route.token)
    expect(readDrawerRoute(origin)).toBeNull()

    const drawer = withDrawerRoute(origin, route)
    expect(readDrawerRoute(drawer)).toEqual(route)
    expect(readDrawerOrigin(drawer)).toBeNull()
  })

  it('window.name 身份跨整页导航可读且模式精确', () => {
    expect(readDrawerFrameName(drawerFrameName(route))).toEqual({ token: route.token, webFull: false })
    expect(readDrawerFrameName(drawerFrameName({ ...route, webFull: true }))).toEqual({ token: route.token, webFull: true })
    expect(readDrawerFrameName('bilikit-drawer:short:web')).toBeNull()
    expect(readDrawerFrameName('other-frame:test-token-123:web')).toBeNull()
  })

  it('只把两个精确内部 hash 认作抽屉标记', () => {
    expect(drawerMark(DRAWER_MARK)).toBe(DRAWER_MARK)
    expect(drawerMark(DRAWER_WEB_MARK)).toBe(DRAWER_WEB_MARK)
    expect(drawerMark('#reply=bk-drawer')).toBeNull()
  })

  it('location 消息只接受预期 origin 的 B 站播放页', () => {
    expect(safeDrawerVideoUrl(
      'https://www.bilibili.com/video/BV1xx#bk-drawer',
      'https://www.bilibili.com',
    )).toBe('https://www.bilibili.com/video/BV1xx')
    expect(safeDrawerVideoUrl(
      'https://space.bilibili.com/1',
      'https://www.bilibili.com',
    )).toBeNull()
    expect(safeDrawerVideoUrl(
      'https://evil.example/video/BV1xx',
      'https://www.bilibili.com',
    )).toBeNull()
    expect(safeDrawerVideoUrl(
      'https://search.bilibili.com/video/BV1xx',
      'https://www.bilibili.com',
    )).toBeNull()
  })
})
