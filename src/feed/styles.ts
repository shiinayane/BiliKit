import { NS } from './shared'

// 注入 feed 网格/卡片/骨架/预览/悬浮按钮的样式。只注入一次。
export function injectStyle(): void {
  if (document.getElementById('bk-feed-style')) return
  const s = document.createElement('style')
  s.id = 'bk-feed-style'
  s.textContent = `
    .${NS}{ display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:22px 16px; padding:16px 0; }
    /* 不再用 content-visibility：真·窗口化已把 DOM 限制在可视附近；且 CV 会让「窗口内但不在视口」的卡
       塌回 contain-intrinsic-size，与视口内卡的真实高不一致 → 滚动时高度抖动。去掉后每卡真实等高。 */
    .${NS}-card{ cursor:pointer; transition:transform .18s ease; }
    .${NS}-card:hover{ transform:translateY(-4px); } /* 悬浮浮起（transform → 合成层，不触发重排） */
    .${NS}-cover{ position:relative; aspect-ratio:16/9; border-radius:8px; overflow:hidden; background:var(--bg2,#e3e5e7); transition:box-shadow .18s ease; }
    .${NS}-card:hover .${NS}-cover{ box-shadow:0 6px 20px rgba(0,0,0,.22); }
    .${NS}-cover img{ width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .35s ease; }
    .${NS}-cover.loaded img{ opacity:1; }
    /* hover 雪碧图预览：盖在封面上，鼠标横向刮帧；在遮罩(z-index:2)之下、图片之上 */
    .${NS}-preview{ position:absolute; inset:0; z-index:1; background-repeat:no-repeat; opacity:0; transition:opacity .15s ease; pointer-events:none; }
    .${NS}-preview.on{ opacity:1; }
    /* hover 真视频预览：低清 dash 静音自动播，盖在封面上（同雪碧图层级 z-index:1，遮罩之下、图片之上） */
    .${NS}-vpreview{ position:absolute; inset:0; z-index:1; width:100%; height:100%; object-fit:cover; display:block; opacity:0; transition:opacity .2s ease; pointer-events:none; background:#000; }
    .${NS}-vpreview.on{ opacity:1; }
    /* Safari 圆角裁剪补丁：透明度过渡的封面图 / 真视频预览会被 Safari 提为合成子层；父卡 hover 浮起(transform)
       期间，Safari 有时不把这些子层裁到 .bk-cover 的 border-radius，方角越过圆角、露出一条缝（深色下尤其明显）。
       给每个「铺满封面、贴到边角」的子层自身也上同款圆角，方角即被磨圆、与父级圆角重合，父级裁剪失效时也不再露缝。
       走 border-radius(仅编译期圆角)而非 -webkit-mask 强裁——后者会把播放中的视频每帧重刷进遮罩缓冲、增功耗。 */
    .${NS}-cover img, .${NS}-vpreview, .${NS}-preview{ border-radius:8px; }
    .${NS}-mask, .${NS}-pbar{ border-radius:0 0 8px 8px; }
    /* 预览播放时：隐藏播放/弹幕数遮罩；右下角时长转「当前 / 总时长」，去渐变、加阴影保可读 */
    .${NS}-cover.previewing .${NS}-mstat{ display:none; }
    .${NS}-cover.previewing .${NS}-mask{ background:none; justify-content:flex-end; }
    .${NS}-cover.previewing .${NS}-mask span{ text-shadow:0 1px 4px rgba(0,0,0,.95); font-variant-numeric:tabular-nums; }
    /* 预览进度条：底部细条，随播放推进（scaleX → 合成层）。z-index:3 压在遮罩之上，短视频也看得清进度 */
    .${NS}-pbar{ position:absolute; left:0; right:0; bottom:0; z-index:3; height:3px; background:rgba(0,0,0,.28); opacity:0; transition:opacity .15s ease; pointer-events:none; }
    .${NS}-pbar.on{ opacity:1; }
    .${NS}-pbar i{ display:block; width:100%; height:100%; background:var(--brand_blue,#00aeec); transform:scaleX(0); transform-origin:left; }
    /* 骨架微光：统一走「合成层友好的 transform 位移伪元素」——封面(未加载)、骨架条、头像同一套，
       只动 transform（GPU 合成，不逐帧重绘），滚动/加载期都不掉帧。封面 .loaded/.failed 后伪元素消失。 */
    .${NS}-shimmer{ position:relative; overflow:hidden; background-color:var(--bg2,#e3e5e7); }
    .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}-shimmer::after{
      content:''; position:absolute; inset:0;
      /* 浅色默认：白光打在浅灰底上看不见 → 用暗色扫光（浅底上才有对比） */
      background:linear-gradient(90deg, transparent 20%, rgba(0,0,0,.07) 50%, transparent 80%);
      transform:translateX(-100%); animation:bk-shimmer 1.6s linear infinite;
    }
    /* 深色：按页面真实底色判定(JS 给 grid 加 .bk-dark)，不用 @media prefers——避免「系统浅/B站深」时不生效。用淡白扫光 */
    .${NS}.bk-dark .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}.bk-dark .${NS}-shimmer::after{
      background:linear-gradient(90deg, transparent 15%, rgba(255,255,255,.11) 50%, transparent 85%);
    }
    @keyframes bk-shimmer{ to{ transform:translateX(100%); } }
    /* 封面底部遮罩：左「播放·弹幕」右「时长」 */
    /* z-index:1 必需：封面 img 有 opacity 过渡，Safari 会把它提升为合成层、盖住本遮罩；
       给遮罩显式 z-index 才能压在图片层之上（否则 z-index:auto 不进合成层，被图片遮住）。 */
    .${NS}-mask{ position:absolute; left:0; right:0; bottom:0; z-index:2; display:flex; align-items:flex-end; justify-content:space-between; padding:8px 8px 7px; color:#fff; font-size:12px; line-height:1; background:linear-gradient(transparent, rgba(0,0,0,.85)); pointer-events:none; }
    .${NS}-mstat{ display:flex; align-items:center; gap:9px; }
    .${NS}-mstat span{ display:inline-flex; align-items:center; gap:3px; }
    .${NS}-mstat svg{ width:15px; height:15px; }
    /* 下方：头像独占左栏，右栏上标题、下「UP名 · 日期」 */
    .${NS}-bottom{ display:flex; gap:10px; margin-top:9px; align-items:flex-start; }
    .${NS}-face{ width:34px; height:34px; flex:0 0 34px; border-radius:50%; object-fit:cover; background:var(--bg2,#e3e5e7); }
    img.${NS}-face{ cursor:pointer; transition:box-shadow .15s ease; } /* 有头像时可点进空间（占位 div 不给手型） */
    img.${NS}-face:hover{ box-shadow:0 0 0 2px var(--brand_blue,#00aeec); } /* hover 强调：品牌色圆环 */
    .${NS}-right{ flex:1; min-width:0; }
    .${NS}-up{ cursor:pointer; } /* UP 名可点进空间 */
    .${NS}-up:hover{ color:var(--brand_blue,#00aeec); }
    /* min-height 固定 2 行：让每张卡等高，虚拟化的行高估算才准、不漂移抖动（1 行标题也占 2 行位） */
    .${NS}-title{ margin:0 0 6px; font-size:15px; font-weight:500; line-height:1.4; min-height:2.8em; color:var(--text1,#18191c); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .${NS}-sub{ display:flex; align-items:center; font-size:13px; color:var(--text3,#9499a0); }
    .${NS}-who{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .${NS}-sub i{ margin:0 5px; font-style:normal; }
    /* 推荐理由行内 pill（学 Gate）：只描边+文字色、不填充；实际配色由 B 站 reason style 内联覆盖 */
    .${NS}-badge{ flex:none; margin-right:6px; padding:0 6px; border:1px solid var(--brand_blue,#00aeec); border-radius:6px; color:var(--brand_blue,#00aeec); background:transparent; font-size:11px; line-height:16px; }
    /* 骨架占位（数据未到时） */
    .${NS}-skline{ height:13px; border-radius:4px; margin-bottom:8px; }
    /* 未装 Core 的提示条（可关闭） */
    .${NS}-warn{ grid-column:1/-1; display:flex; align-items:center; gap:12px; margin-bottom:6px; padding:10px 14px; border-radius:10px; background:var(--bg2,#f1f2f3); color:var(--text2,#61666d); font-size:13px; }
    .${NS}-warn b{ color:var(--text1,#18191c); }
    .${NS}-warn a{ color:var(--brand_blue,#00aeec); text-decoration:none; white-space:nowrap; }
    .${NS}-warn .bk-x{ margin-left:auto; border:0; background:transparent; color:var(--text3,#9499a0); cursor:pointer; font-size:14px; line-height:1; padding:4px; }
    .${NS}-warn .bk-x:hover{ color:var(--text1,#18191c); }
    .${NS}-spacer{ grid-column:1/-1; height:0; }  /* 窗口化：上下占位行，撑起未渲染区的高度，保滚动位置 */
    .${NS}-sentinel{ grid-column:1/-1; height:1px; }
    .${NS}-tip{ grid-column:1/-1; text-align:center; color:var(--text3,#9499a0); font-size:13px; padding:20px; }
    .${NS}-fab{ position:fixed; right:24px; bottom:32px; z-index:1000; display:flex; flex-direction:column; gap:10px; }
    /* 悬浮工具按钮：圆形 + 细描边 + 表面底 + 轻阴影，hover 变品牌色微浮起、按下微缩 */
    .${NS}-fab button{
      width:40px; height:40px; border-radius:50%; padding:0;
      display:flex; align-items:center; justify-content:center;
      border:1px solid var(--line_regular,#e3e5e7); background:var(--bg1,#fff); color:var(--text2,#61666d);
      cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,.12);
      transition:color .16s ease, transform .16s ease, box-shadow .16s ease, opacity .18s ease;
    }
    .${NS}-fab button:hover{ color:var(--brand_blue,#00aeec); transform:translateY(-2px); box-shadow:0 5px 16px rgba(0,0,0,.2); }
    .${NS}-fab button:active{ transform:scale(.94); }
    .${NS}-fab .bk-top{ opacity:0; pointer-events:none; transform:scale(.85); }      /* 默认藏，滚动后现 */
    .${NS}-fab.scrolled .bk-top{ opacity:1; pointer-events:auto; transform:none; }
    .${NS}-fab button.busy{ pointer-events:none; }
    .${NS}-fab button.busy svg{ animation:bk-spin .8s linear infinite; }
    @keyframes bk-spin{ to{ transform:rotate(360deg); } }
  `
  ;(document.head || document.documentElement).appendChild(s)
}

// 清理首页原生 chrome（接管 feed 后残留的干扰件）。只注入一次。
export function hideNativeChrome(): void {
  if (document.getElementById('bk-feed-chrome')) return
  const s = document.createElement('style')
  s.id = 'bk-feed-chrome'
  s.textContent = `
    .feed-roll-btn { display: none !important; }        /* 右侧「换一换」 */
    .palette-button-wrap { display: none !important; }   /* 右下角 刷新内容/更多/返回顶部 */
    .adblock-tips { display: none !important; }          /* 顶部「检测到浏览器插件…加入白名单」提示 */
    /* 分区栏「不钉顶」：.header-channel 是 B 站在滚动后注入的钉顶副本（首屏时 h=0、空），
       真正可见的分区在 .bili-header 内、会随页滚走。隐掉这个副本即可：分区仍在（顶部那份），
       只是不再钉顶，也避开了它注入高度时引发的画面抽搐。 */
    .header-channel { display: none !important; }
  `
  ;(document.head || document.documentElement).appendChild(s)
}
