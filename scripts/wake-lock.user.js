// ==UserScript==
// @name         BiliKit · 防睡眠
// @name:en      BiliKit · Wake Lock
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.2.0
// @description    防止使用 Safari 在 B 站播放视频时休眠或睡眠。
// @description:en Keep Safari from sleeping while playing a Bilibili video.
// @match        https://www.bilibili.com/video/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/573479/%E9%98%B2%E6%AD%A2B%E7%AB%99%E7%9D%A1%E7%9C%A0.user.js
// @updateURL https://update.greasyfork.org/scripts/573479/%E9%98%B2%E6%AD%A2B%E7%AB%99%E7%9D%A1%E7%9C%A0.meta.js
// ==/UserScript==

(() => {
  'use strict';

  if (!('wakeLock' in navigator)) {
    console.log('[WakeLock] Not supported');
    return;
  }

  // 单例守卫：防止脚本被重复安装/注入导致重复监听 / 多次 wakeLock 申请。
  if (window.__BILIKIT_WAKE_LOCK__) return;
  window.__BILIKIT_WAKE_LOCK__ = true;

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log('[WakeLock]', ...args); };

  let sentinel = null;
  let currentVideo = null;
  let retryTimer = null;
  let acquiring = false; // 申请进行中，防并发申请导致泄漏一个锁

  async function requestWakeLock() {
    if (sentinel || acquiring) return;
    // 没有在播的视频不申请：防止「释放后安排重试 → 期间用户暂停 → 重试仍拿锁」让屏幕常亮。
    if (!currentVideo || currentVideo.paused) return;
    // 页面隐藏时无法申请（且系统会自动释放），直接返回；切回可见时由 visibilitychange 重新申请，
    // 避免「隐藏 → 申请失败 → 重试 → 再失败」的无效循环。
    if (document.visibilityState !== 'visible') return;

    acquiring = true;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      log('acquired');

      sentinel.addEventListener('release', () => {
        log('released');
        sentinel = null;

        // 如果视频还在播，自动重新申请（隐藏导致的释放会被 requestWakeLock 的可见性检查挡掉）
        if (currentVideo && !currentVideo.paused) {
          retryWakeLock();
        }
      });
    } catch (err) {
      log('failed:', err);
      retryWakeLock();
    } finally {
      acquiring = false;
    }
  }

  function retryWakeLock() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      requestWakeLock();
    }, 2000);
  }

  async function releaseWakeLock() {
    // 同时取消待执行的重试，避免暂停后定时器把锁「复活」
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    try {
      if (sentinel) {
        await sentinel.release();
        sentinel = null;
        log('manually released');
      }
    } catch (_) {}
  }

  // 媒体事件不冒泡但会经过捕获阶段，在 document 上统一代理即可感知任意 <video>
  // 的开播/暂停/结束——换 P、播放器重建后的新元素一开播就会被接管，
  // 无需 MutationObserver 盯着弹幕页的高频 DOM 变动。
  document.addEventListener('playing', (e) => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    if (currentVideo !== e.target) {
      log('bind new video');
      currentVideo = e.target;
    }
    requestWakeLock();
  }, true);

  const onMediaStop = (e) => {
    if (e.target === currentVideo) releaseWakeLock();
  };
  document.addEventListener('pause', onMediaStop, true);
  document.addEventListener('ended', onMediaStop, true);

  // 监听页面可见性：切回可见且仍在播放时重新申请
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      currentVideo &&
      !currentVideo.paused
    ) {
      log('visibility resume');
      requestWakeLock();
    }
  });

  // 启动时已在播放的视频不会再触发 playing，主动找一次
  const initial = document.querySelector('video');
  if (initial && !initial.paused) {
    currentVideo = initial;
    requestWakeLock();
  }

})();
