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
    /* 预览进度条：底部细条，随播放推进（scaleX → 合成层）。z-index:3 压在遮罩之上，短视频也看得清进度 */
    .${NS}-pbar{ position:absolute; left:0; right:0; bottom:0; z-index:3; height:3px; background:rgba(0,0,0,.28); opacity:0; transition:opacity .15s ease; pointer-events:none; }
    .${NS}-pbar.on{ opacity:1; }
    .${NS}-pbar i{ display:block; width:100%; height:100%; background:var(--brand_blue,#00aeec); transform:scaleX(0); transform-origin:left; }
    /* 骨架微光：统一走「合成层友好的 transform 位移伪元素」——封面(未加载)、骨架条、头像同一套，
       只动 transform（GPU 合成，不逐帧重绘），滚动/加载期都不掉帧。封面 .loaded/.failed 后伪元素消失。 */
    .${NS}-shimmer{ position:relative; overflow:hidden; background-color:var(--bg2,#e3e5e7); }
    .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}-shimmer::after{
      content:''; position:absolute; inset:0;
      background:linear-gradient(90deg, transparent 25%, rgba(255,255,255,.28) 50%, transparent 75%);
      transform:translateX(-100%); animation:bk-shimmer 1.6s linear infinite;
    }
    /* 深色模式下白色高光过刺眼，压到很淡 */
    @media (prefers-color-scheme: dark){
      .${NS}-cover:not(.loaded):not(.failed)::after, .${NS}-shimmer::after{ background:linear-gradient(90deg, transparent 25%, rgba(255,255,255,.09) 50%, transparent 75%); }
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
    .${NS}-spacer{ grid-column:1/-1; height:0; }  /* 窗口化：上下占位行，撑起未渲染区的高度，保滚动位置 */
    .${NS}-sentinel{ grid-column:1/-1; height:1px; }
    .${NS}-tip{ grid-column:1/-1; text-align:center; color:var(--text3,#9499a0); font-size:13px; padding:20px; }
    .${NS}-fab{ position:fixed; right:24px; bottom:32px; z-index:1000; display:flex; flex-direction:column; gap:10px; }
    .${NS}-fab button{ width:44px; height:44px; border-radius:50%; border:1px solid var(--line_regular,#e3e5e7); background:var(--bg1,#fff); color:var(--text2,#61666d); cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.14); display:flex; align-items:center; justify-content:center; padding:0; transition:opacity .18s, transform .18s, color .18s; }
    .${NS}-fab button:hover{ color:var(--brand_blue,#00aeec); transform:translateY(-2px); }
    .${NS}-fab button:active{ transform:translateY(0); }
    .${NS}-fab .bk-top{ opacity:0; pointer-events:none; transform:scale(.85); }      /* 默认藏，滚动后现 */
    .${NS}-fab.scrolled .bk-top{ opacity:1; pointer-events:auto; transform:none; }
    .${NS}-fab button.busy{ pointer-events:none; }
    .${NS}-fab button.busy svg{ animation:bk-spin .8s linear infinite; }
    @keyframes bk-spin{ to{ transform:rotate(360deg); } }
    /* 底部上滑抽屉：顶部留 48px 缝(显遮罩、点击关闭)；关闭/新标签是缝里的独立浮动按钮 */
    .${NS}-dmask{ position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .3s ease; }
    .${NS}-dmask.on{ opacity:1; pointer-events:auto; } /* 关闭后 pointer-events:none，否则透明遮罩仍拦全站点击 */
    .${NS}-drawer{ position:fixed; left:0; right:0; bottom:0; height:calc(100% - 48px); z-index:100001; display:flex; flex-direction:column; background:var(--bg1,#fff); border-radius:14px 14px 0 0; box-shadow:0 -8px 40px rgba(0,0,0,.35); transform:translateY(100%); transition:transform .32s cubic-bezier(.32,.72,0,1); overflow:hidden; }
    .${NS}-drawer.on{ transform:translateY(0); }
    .${NS}-dframe{ flex:1; width:100%; border:0; display:block; }
    /* 下拉提示气泡（顶部缝里居中，拖拽时淡入） */
    .${NS}-dhint{ position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:100002; font-size:12px; color:#fff; background:rgba(0,0,0,.55); padding:3px 12px; border-radius:12px; opacity:0; pointer-events:none; transition:opacity .15s ease; -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); }
    .${NS}-dhint.on{ opacity:1; }
    /* 加载遮罩：封面模糊铺底 + spinner，盖住打开瞬间黑→白闪 */
    .${NS}-dload{ position:absolute; inset:0; z-index:1; display:flex; align-items:center; justify-content:center; background:#18191c; opacity:0; pointer-events:none; transition:opacity .3s ease; }
    .${NS}-drawer.loading .${NS}-dload{ opacity:1; }
    .${NS}-dload-cover{ position:absolute; inset:0; background-size:cover; background-position:center; filter:blur(24px) brightness(.6); transform:scale(1.1); }
    .${NS}-dspin{ position:relative; width:42px; height:42px; border:3px solid rgba(255,255,255,.2); border-top-color:var(--brand_blue,#00aeec); border-radius:50%; animation:bk-spin .8s linear infinite; }
    @media (prefers-color-scheme: light){ .${NS}-dload{ background:#f4f4f5; } .${NS}-dspin{ border-color:rgba(0,0,0,.12); border-top-color:var(--brand_blue,#00aeec); } }
    /* 顶部缝里的独立浮动按钮 */
    .${NS}-dctrls{ position:fixed; top:9px; right:16px; z-index:100002; display:flex; gap:10px; opacity:0; pointer-events:none; transition:opacity .3s ease; }
    .${NS}-dctrls.on{ opacity:1; pointer-events:auto; }
    .${NS}-dctrls button{ width:34px; height:34px; border-radius:50%; border:0; background:rgba(0,0,0,.55); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); }
    .${NS}-dctrls button:hover{ background:rgba(0,0,0,.78); }
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
