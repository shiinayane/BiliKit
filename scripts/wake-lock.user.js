// ==UserScript==
// @name         BiliKit · 防睡眠
// @name:en      BiliKit · Wake Lock
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.1.3
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

  // 单例守卫：防止脚本被重复安装/注入导致多个 observer / 多次 wakeLock 申请。
  if (window.__BILIKIT_WAKE_LOCK__) return;
  window.__BILIKIT_WAKE_LOCK__ = true;

  let sentinel = null;
  let currentVideo = null;
  let retryTimer = null;
  let acquiring = false; // 申请进行中，防并发申请导致泄漏一个锁

  async function requestWakeLock() {
    if (sentinel || acquiring) return;
    // 页面隐藏时无法申请（且系统会自动释放），直接返回；切回可见时由 visibilitychange 重新申请，
    // 避免「隐藏 → 申请失败 → 重试 → 再失败」的无效循环。
    if (document.visibilityState !== 'visible') return;

    acquiring = true;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      console.log('[WakeLock] acquired');

      sentinel.addEventListener('release', () => {
        console.log('[WakeLock] released');
        sentinel = null;

        // 如果视频还在播，自动重新申请（隐藏导致的释放会被 requestWakeLock 的可见性检查挡掉）
        if (currentVideo && !currentVideo.paused) {
          retryWakeLock();
        }
      });
    } catch (err) {
      console.log('[WakeLock] failed:', err);
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
    try {
      if (sentinel) {
        await sentinel.release();
        sentinel = null;
        console.log('[WakeLock] manually released');
      }
    } catch (_) {}
  }

  function bindVideo(video) {
    if (currentVideo === video) return;

    console.log('[WakeLock] bind new video');
    currentVideo = video;

    video.addEventListener('playing', requestWakeLock);
    video.addEventListener('pause', releaseWakeLock);
    video.addEventListener('ended', releaseWakeLock);

    // 已经在播放时直接申请
    if (!video.paused) {
      requestWakeLock();
    }
  }

  // 监听页面可见性
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      currentVideo &&
      !currentVideo.paused
    ) {
      console.log('[WakeLock] visibility resume');
      requestWakeLock();
    }
  });

  // 持续检测 video（解决 B站换P/刷新播放器）
  const observer = new MutationObserver(() => {
    // 当前 video 还在文档里就跳过，避免弹幕等高频 DOM 变动时每次都 querySelector
    if (currentVideo && currentVideo.isConnected) return;
    const video = document.querySelector('video');
    if (video) {
      bindVideo(video);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

})();
