import type { BiliKitModule } from '../../core/module'

/**
 * 防睡眠：播放视频时申请 screen wake lock，阻止 Safari 休眠/屏保。
 * 迁移自 scripts/wake-lock.user.js（逻辑不变，去掉头与 IIFE）。
 */
function init(): void {
  const nav = navigator as any
  if (!('wakeLock' in navigator)) return

  // 单例守卫：与仍在用的旧独立脚本共存时防重复监听/重复申请
  if ((window as any).__BILIKIT_WAKE_LOCK__) return
  ;(window as any).__BILIKIT_WAKE_LOCK__ = true

  const DEBUG = false
  const log = (...args: unknown[]) => {
    if (DEBUG) console.log('[WakeLock]', ...args)
  }

  let sentinel: any = null
  let currentVideo: HTMLVideoElement | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let acquiring = false // 申请进行中，防并发申请泄漏一个锁

  async function requestWakeLock(): Promise<void> {
    if (sentinel || acquiring) return
    // 没有在播的视频不申请：防止「释放后安排重试 → 期间用户暂停 → 重试仍拿锁」让屏幕常亮
    if (!currentVideo || currentVideo.paused) return
    // 页面隐藏时无法申请（且系统会自动释放）；切回可见由 visibilitychange 重新申请
    if (document.visibilityState !== 'visible') return

    acquiring = true
    try {
      sentinel = await nav.wakeLock.request('screen')
      log('acquired')

      sentinel.addEventListener('release', () => {
        log('released')
        sentinel = null
        if (currentVideo && !currentVideo.paused) retryWakeLock()
      })

      // await 在途时用户可能已暂停/切走：拿到了也立刻放掉
      if (!currentVideo || currentVideo.paused || document.visibilityState !== 'visible') {
        log('stale acquire, releasing')
        await sentinel.release()
      }
    } catch (err) {
      log('failed:', err)
      retryWakeLock()
    } finally {
      acquiring = false
    }
  }

  function retryWakeLock(): void {
    if (retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      requestWakeLock()
    }, 2000)
  }

  async function releaseWakeLock(): Promise<void> {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    try {
      if (sentinel) {
        await sentinel.release()
        sentinel = null
        log('manually released')
      }
    } catch {
      /* ignore */
    }
  }

  // 停播信号直接挂被接管的元素上，而非 document 捕获代理：B 站重建播放器时会把正在播的
  // <video> 移出 DOM，脱离后元素上触发的 pause/ended 没有祖先链，document 捕获听不到。
  const onMediaStop = (e: Event) => {
    if (e.target === currentVideo) releaseWakeLock()
  }
  function bindVideo(v: HTMLVideoElement): void {
    if (currentVideo === v) return
    if (currentVideo) {
      currentVideo.removeEventListener('pause', onMediaStop)
      currentVideo.removeEventListener('ended', onMediaStop)
      currentVideo.removeEventListener('emptied', onMediaStop)
    }
    log('bind new video')
    currentVideo = v
    v.addEventListener('pause', onMediaStop)
    v.addEventListener('ended', onMediaStop)
    v.addEventListener('emptied', onMediaStop)
  }

  // 开播信号走 document 捕获代理（媒体事件不冒泡但经过捕获阶段）：换 P、播放器重建后的
  // 新元素一开播就被接管，无需 MutationObserver 盯高频 DOM 变动。
  document.addEventListener(
    'playing',
    (e) => {
      if (!(e.target instanceof HTMLVideoElement)) return
      bindVideo(e.target)
      requestWakeLock()
    },
    true,
  )

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentVideo && !currentVideo.paused) {
      log('visibility resume')
      requestWakeLock()
    }
  })

  // 启动时已在播放的视频不会再触发 playing，主动找一次
  const initial = document.querySelector('video')
  if (initial && !initial.paused) {
    bindVideo(initial)
    requestWakeLock()
  }
}

export const wakeLock: BiliKitModule = {
  id: 'wake-lock',
  name: '防睡眠',
  description: '播放视频时阻止 Safari 休眠 / 屏保',
  category: '播放',
  runAt: 'idle',
  init,
}
