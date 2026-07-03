# 封面 hover 预览：MSE 方案调研与设计

> 目标：把 Feed 的封面 hover 预览做成**原生手机 App 那种秒开**——用 **MSE(Media Source Extensions)**
> 只抓「够播头几秒」的字节喂 `<video>`，起播快、流量省。要求 **Safari / Chrome / Firefox 通用，
> 且 Safari 体验也好**。失败自动回退到现有 `<video src=durl>` → 雪碧图，保证永远有预览。
>
> 结论来自 2026-07 联网核实（MDN / caniuse / WebKit blog / bitmovin / bilibili-API-collect 镜像）。

## 一、为什么是 MSE

- `<video src=整段文件>`：浏览器自己决定缓冲多少，实测 Safari 对渐进 durl mp4 起播 600–2500ms、对
  video-only dash 直喂更差（见 diag 实测，最坏 24s）。控制权不在我们手里。
- **MSE**：JS 自建 `MediaSource` 挂到 `<video>`，**自己抓字节 `appendBuffer()`**。只抓 init 段 +
  第一个媒体分段（几百 KB）就能起播——这正是原生 hover 快的根因（探针实测原生 `<video>` src 是 `blob:` = MSE）。

## 二、浏览器支持矩阵（2026-07 核实）

| | 桌面 Chrome/Edge/FF | **桌面 Safari** | iOS Safari | 备注 |
|---|---|---|---|---|
| `MediaSource`（经典 MSE） | ✅ | ✅ Safari 8+(2015) | ❌ | 我们主要目标是 macOS 桌面 Safari |
| `ManagedMediaSource`(MMS) | ✅ Chrome 122+ | ✅ Safari 17+ | ✅ **仅此**(17.1+) | 与 MediaSource **向后兼容**，同一套代码 |

**结论**：`const MS = window.ManagedMediaSource || window.MediaSource`。
- 桌面三家都吃经典 MSE；Safari 17+ 优先用 MMS（浏览器托管缓冲、更省电/内存）。
- 都没有 → 直接回退 durl `<video src>`（现有可用路径）。

## 三、Bilibili dash 字段（web wbi playurl，实测/文档核实）

`dash.video[]` 每条：
```jsonc
{
  "id": 16,                 // 清晰度码：16=360P 32=480P 64=720P 80=1080P
  "codecid": 7,             // 7=AVC(H.264) 12=HEVC 13=AV1
  "codecs": "avc1.640032",  // ← 直接用作 SourceBuffer 的 codec 串
  "baseUrl": "https://upos-.../....m4s?...",
  "backupUrl": ["https://..."],
  "segment_base": {         // 也可能是 SegmentBase（大小写两种，需兼容）
    "initialization": "0-996",   // ftyp+moov（init 段）字节范围
    "index_range": "997-1856"    // sidx（分段索引）字节范围
  }
}
```
- **init 段** = `initialization` 范围字节（含 moov，MSE 必须先 append 它）。
- **sidx** = `index_range` 范围字节（描述后续每个 fragment 的大小/时长）。
- **媒体分段**从 `index_range` 末尾 +1 开始，一个个 moof+mdat。

**选轨**：只取 **codecid=7(AVC)** 的**最低清**那条（AVC 三家都能解；AV1 Safari 解不了，HEVC 仅 Safari）。
分段最小 → 起播最快、最省流量。无 AVC dash → 回退 durl。

## 四、取流管线（设计）

1. **playurl**：`wbi/playurl?fnval=16&qn=16`（已在 play-url.ts，带 cookie 拿登录清晰度）。
2. **选轨**：dash.video 里 codecid=7 最低 id。拿到 `baseUrl(+backupUrl)`、`codecs`、`initialization`、`index_range`。
3. **主机加速**：baseUrl 若 upos 系，swap 成用户在 Core 选的镜像（复用 play-url 的 prefer/swap）。备份留作回退。
4. **抓字节**（**优先浏览器 `fetch()`**——实测原生 hover 就是 `fetch()` 拿分段，bilivideo 对 bilibili.com 源放行
   CORS、冷门视频 CDN 也回 206；**GM 只作兜底**：GM.xmlHttpRequest 会被 CDN 反爬 403 掉冷门视频。
   （早期误以为「upos 无 CORS 必须走 GM」，是探测原生后纠正的关键结论。））：
   - `fetch(url, {headers:{Range}, credentials:'omit'})` → 206 → `arrayBuffer()`；失败退回 `gmRequestBinary`。
   - **init**：`Range: 0-{initEnd}` → ArrayBuffer。
   - **sidx**：`Range: {index_range}` → 解析 sidx 得头几个 fragment 的字节边界（见下）。
   - **首窗**：从 `indexEnd+1` 取「够播 ~6 秒」的整数个 fragment（用 sidx 累加大小，取到边界，**不截半**）。
5. **喂 MSE**：
   ```
   const ms = new (window.ManagedMediaSource || window.MediaSource)()
   video.disableRemotePlayback = true          // MMS 要求（否则可能不可用）
   video.src = URL.createObjectURL(ms)          // MMS 也兼容这种挂法
   ms.addEventListener('sourceopen', () => {
     const sb = ms.addSourceBuffer(`video/mp4; codecs="${codecs}"`)
     await append(sb, initBuf)                  // 必须先 init
     await append(sb, firstFragmentsBuf)
     ms.endOfStream()                           // 单窗 + loop：不再拉，循环播缓冲区
   })
   video.muted = true; video.loop = true; video.play()
   ```
   `append` = `sb.appendBuffer(buf)` 后等 `updateend`；**append 前必须 `sb.updating===false`**。

**sidx 解析**（~30 行）：sidx box 里 `reference_count` + 每条 `referenced_size`(31bit)。累加 size 直到覆盖 ~6s
时长（或取前 N 条），得到「首窗」应抓的总字节数 → 保证抓的是**整数个 fragment**、不截半（截半会 append 报错/丢尾）。
> v1 可先简化：不解析 sidx，直接从 `indexEnd+1` 抓固定 ~800KB–1MB，容忍尾部半个 fragment（MSE 通常忽略不完整尾块）。
> 若实测 append 报错，再上 sidx 精确边界。

## 五、Safari 专项

- **优先 MMS**（Safari 17+）：`disableRemotePlayback=true`；MMS 会「随时可能回收已缓冲区间」——单窗 loop 若被回收
  会卡，故监听 `startstreaming`/检测 stall 时**重 append 首窗**兜底。桌面 Safari <17 用经典 MediaSource 无此问题。
- **video-only 风险**：Safari 的 MSE 对「只有视频轨、无音轨」历史上偶有不播/卡的报告（社区）。
  **对策**：起播看门狗——挂 MSE 后 **~1.5s 内没到 `playing` 事件**就判失败，拆掉 MSE、回退 durl `<video src>`。
  这样即使个别 Safari 版本 video-only MSE 抽风，用户也只是拿到"次快"的 durl，不会没预览。
- **codec 串必须精确**：用 dash 给的 `codecs` 原样（如 `avc1.640032`）；错了 Safari 静默 append 失败。

## 六、分层回退（保证永远有预览）

```
真视频(video 模式)：
  MSE(最优, 原生级)  ──失败/不支持/1.5s看门狗超时──►  durl <video src>(次优, 现有)  ──失败──►  (无预览)
雪碧图(sprite 模式)：独立分支，面板可选
关闭(off)
```
面板「封面预览」项不变（video / sprite / off）；`video` 内部自动挑 MSE→durl。

## 七、性能账

- **流量**：MSE 只抓 init + ~6s 首窗（360p ≈ 300–800KB），loop 复用，**不再下整段文件**（durl 会随 loop 下全片）。
  海外尤其划算（抓得少、还能配镜像）。
- **内存**：单窗几 MB；MMS 下浏览器自动回收。
- **CPU**：一路视频解码 + 少量 JS append，可忽略。
- **起播**：目标 ~原生级（playurl 已并行藏在 hover 延迟里；MSE 拿到首窗即播）。

## 八、待实现清单 / 风险

- [ ] `gmRequestBinary(url, {rangeStart,rangeEnd})` → ArrayBuffer（app-api.ts 加）。
- [ ] sidx 解析（可 v1 跳过，用固定窗）。
- [ ] `src/feed/mse-preview.ts`：建 MS/MMS、append、看门狗、loop、清理（hover 走时 revokeObjectURL + video 移除）。
- [ ] play-url.ts：dash 选轨时**同时返回** codecs/initialization/index_range（现在只返回 url 串，要扩成结构）。
- [ ] video-preview.ts：先试 MSE，超时/失败回退 durl。
- **风险**：① 个别视频只有 AV1/HEVC dash（回退 durl）；② upos Range 请求要不要 Referer（GM 设上，个别版本可能忽略）；
  ③ Safari video-only MSE 抽风（看门狗兜底）；④ MMS 回收缓冲致 loop 卡（重 append 兜底）。

## 参考

- MDN [MediaSource](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource) / [SourceBuffer.appendBuffer](https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/appendBuffer)
- caniuse [MediaSource](https://caniuse.com/mediasource) / [ManagedMediaSource](https://caniuse.com/mdn-api_managedmediasource)
- WebKit [Safari 17.1 features](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/)、bitmovin [Managed Media Source](https://bitmovin.com/blog/managed-media-source/)
- bilibili-API-collect 镜像 [视频流 URL](https://lxb007981.github.io/bilibili-API-collect/video/videostream_url.html)
