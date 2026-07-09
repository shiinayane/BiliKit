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
    /* hover 浮起用 top 偏移而**不是 transform**：transform 会把这张卡提成合成层、移开又拆掉——
       WebKit 的重叠测试会把「视觉边界（含 hover 大投影，伸进邻卡）与之重叠、绘制顺序在后」的邻卡内容
       连带提升/降回合成层；网格列宽是 1fr 分数像素，文字在普通绘制与合成层上的亚像素栅格化不同，
       建/拆层那一瞬邻卡遮罩文字就会肉眼可见地「动一下」（圆角裁剪短暂失效露缝也是同一根）。
       top 是纯绘制偏移（position:relative 已就位）：不建层、不触发邻卡任何变化，只重绘本卡区域。 */
    .${NS}-card{ cursor:pointer; top:0; transition:top .18s ease; }
    .${NS}-card:hover{ top:-4px; }
    /* isolation:isolate 给封面建独立层叠上下文——修 WebKit #77572：overflow:hidden+border-radius 容器里
       含硬件合成子层（尤其 hover 预览的 <video>，媒体合成面无视元素 border-radius）时，Safari 不把子层裁到
       圆角、露缝；且因 stop() 保留 video 供秒回放，视频层常驻不走，缝就一直留着（移开也不恢复）。
       建层叠上下文即让 Safari 正确裁剪。不用 -webkit-mask（那会每帧把播放中的视频重刷进遮罩缓冲、增功耗）。 */
    .${NS}-cover{ position:relative; isolation:isolate; aspect-ratio:16/9; border-radius:8px; overflow:hidden; background:var(--bg2,#e3e5e7); transition:box-shadow .18s ease; }
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
    .${NS}-bottom{ position:relative; z-index:2; display:flex; gap:10px; margin-top:9px; align-items:flex-start; } /* z-index:2 压过封面合成层，向上弹的三点菜单才不被封面盖住 */
    .${NS}-face{ width:34px; height:34px; flex:0 0 34px; border-radius:50%; object-fit:cover; background:var(--bg2,#e3e5e7); }
    img.${NS}-face{ cursor:pointer; transition:box-shadow .15s ease; } /* 有头像时可点进空间（占位 div 不给手型） */
    img.${NS}-face:hover{ box-shadow:0 0 0 2px var(--brand_blue,#00aeec); } /* hover 强调：品牌色圆环 */
    .${NS}-right{ flex:1; min-width:0; }
    .${NS}-up{ cursor:pointer; } /* UP 名可点进空间 */
    .${NS}-up:hover{ color:var(--brand_blue,#00aeec); }
    /* min-height 固定 2 行：让每张卡等高，虚拟化的行高估算才准、不漂移抖动（1 行标题也占 2 行位） */
    .${NS}-title{ margin:0 0 6px; font-size:15px; font-weight:500; line-height:1.4; min-height:2.8em; color:var(--text1,#18191c); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; transition:color .16s ease; }
    .${NS}-title:hover{ color:var(--brand_blue,#00aeec); } /* 与 UP 名一致：hover 标题本身即高亮成品牌色，示意可点 */
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
    /* 推荐源切换器：占一个 FAB 槽（40x40）；默认只显当前源（.bk-src-cur 复用 fab 圆钮样式），
       hover（或触屏 .open）当前钮淡出、竖向胶囊(.bk-src-pop)从底部对齐向上展开列出两项。 */
    .${NS}-src{ position:relative; width:40px; height:40px; }
    .${NS}-src-cur{ position:absolute; inset:0; transition:opacity .16s ease; }
    .${NS}-src:hover .${NS}-src-cur, .${NS}-src.open .${NS}-src-cur{ opacity:0; pointer-events:none; }
    .${NS}-src-pop{ position:absolute; right:0; bottom:0; z-index:1; display:flex; flex-direction:column;
      border-radius:20px; background:var(--bg1,#fff); border:1px solid var(--line_regular,#e3e5e7);
      box-shadow:0 4px 16px rgba(0,0,0,.18); overflow:hidden;
      opacity:0; visibility:hidden; transform:translateY(6px);
      transition:opacity .16s ease, transform .16s ease, visibility .16s; }
    .${NS}-src:hover .${NS}-src-pop, .${NS}-src.open .${NS}-src-pop{ opacity:1; visibility:visible; transform:none; }
    /* 胶囊里的两项：去掉 fab 圆钮的边/底/影/圆，做成连续竖条；当前项品牌色高亮 */
    .${NS}-fab .${NS}-src-opt{ width:40px; height:40px; border:0; border-radius:0; background:transparent; box-shadow:none; color:var(--text2,#61666d); }
    .${NS}-fab .${NS}-src-opt:hover{ transform:none; box-shadow:none; background:var(--bg2,#e3e5e7); color:var(--brand_blue,#00aeec); }
    .${NS}-fab .${NS}-src-opt.on{ color:var(--brand_blue,#00aeec); }

    /* ——— 卡片操作：稍后再看 / 我不想看 / 撤销浮层 ——— */
    .${NS}-card{ position:relative; } /* 承载「不想看」模糊浮层的定位上下文 */
    /* 三点菜单展开时抬高本卡层级，否则溢出的菜单会被 DOM 后面的卡片盖住。
       触发条件收窄为「悬到三点按钮本身」+ menuopen，而不是「悬到整张卡」——
       z-index 变化会让 Safari 重排该网格的合成层绘制顺序，touch 太频繁（鼠标扫过任意卡都算）会让
       其它卡片的圆角裁剪（同类 Safari 合成层 bug，见上面 border-radius 那段注释）瞬间失效、露出缝隙。
       用 :has() 把触发范围缩到「真悬到三点按钮」这个小目标上，日常划过网格不再触发全局重排。 */
    .${NS}-card:has(.${NS}-more-wrap:hover), .${NS}-card.menuopen{ z-index:20; }
    /* 稍后再看：封面右上角，hover 现（触屏首触即现）。深色封面上永远白图标、暗玻璃底 */
    .${NS}-wl{ position:absolute; top:8px; right:8px; z-index:3; width:32px; height:32px; border-radius:50%; border:0; padding:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.55); color:#fff; cursor:pointer; opacity:0; transform:translateY(-4px); -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px); transition:opacity .18s ease, transform .18s ease, background .16s ease; }
    .${NS}-wl svg{ width:17px; height:17px; }
    .${NS}-card:hover .${NS}-wl{ opacity:1; transform:none; }
    .${NS}-wl:hover{ background:var(--brand_blue,#00aeec); }
    .${NS}-wl.busy{ pointer-events:none; }
    .${NS}-wl.busy svg{ animation:bk-spin .8s linear infinite; }
    .${NS}-wl.done{ opacity:1; transform:none; background:var(--brand_blue,#00aeec); }
    /* 三点「我不想看」：随 UP名·日期行右端、常显（不再压标题，标题恢复占满右侧宽度）。
       给 sub 定个 min-height，让「有菜单」与「无菜单」的卡等高，虚拟化行高不漂移。菜单向上弹（本行在卡底部）。 */
    .${NS}-sub{ min-height:22px; }
    .${NS}-more-wrap{ position:relative; flex:none; margin-left:auto; } /* auto 把三点推到本行最右端 */
    .${NS}-more{ width:22px; height:22px; border:0; padding:0; border-radius:6px; background:transparent; color:var(--text3,#9499a0); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .16s ease, color .16s ease; }
    .${NS}-more svg{ width:16px; height:16px; }
    .${NS}-more:hover{ background:var(--bg2,#e3e5e7); color:var(--text1,#18191c); }
    /* 菜单向上弹；z-index 高 + 下方 .bk-feed-bottom 抬到封面之上（封面是 Safari 合成层，否则菜单被自家封面盖住） */
    .${NS}-menu{ position:absolute; bottom:26px; right:0; z-index:30; min-width:136px; padding:4px; background:var(--bg1,#fff); border:1px solid var(--line_regular,#e3e5e7); border-radius:8px; box-shadow:0 6px 24px rgba(0,0,0,.16); opacity:0; visibility:hidden; transform:translateY(4px); transition:opacity .16s ease, transform .16s ease, visibility .16s; }
    .${NS}-more-wrap:hover .${NS}-menu, .${NS}-more-wrap.open .${NS}-menu{ opacity:1; visibility:visible; transform:none; }
    .${NS}-mi{ display:block; width:100%; text-align:left; padding:8px 10px; border:0; border-radius:6px; background:transparent; color:var(--text1,#18191c); font-size:13px; white-space:nowrap; cursor:pointer; }
    .${NS}-mi:hover{ background:var(--bg2,#e3e5e7); color:var(--brand_blue,#00aeec); }
    /* 提交「不想看」后：卡片内容模糊压暗 + 浮层（愁脸文案 + 撤销），淡入过渡 */
    .${NS}-card.disliked{ cursor:default; }
    .${NS}-card.disliked:hover{ top:0; } /* 已「不想看」的卡不再浮起（浮起改走 top，见上） */
    .${NS}-card.disliked .${NS}-cover, .${NS}-card.disliked .${NS}-bottom{ filter:blur(5px); opacity:.5; pointer-events:none; transition:filter .28s ease, opacity .28s ease; }
    .${NS}-dov{ position:absolute; inset:0; z-index:8; display:none; align-items:center; justify-content:center; }
    .${NS}-card.disliked .${NS}-dov{ display:flex; animation:bk-dov-in .26s ease; }
    @keyframes bk-dov-in{ from{ opacity:0; transform:scale(.96); } to{ opacity:1; transform:none; } }
    .${NS}-dov-in{ display:flex; flex-direction:column; align-items:center; gap:11px; padding:12px; text-align:center; }
    .${NS}-dov-txt{ color:var(--text1,#18191c); font-size:14px; font-weight:500; }
    .${NS}-undo{ display:inline-flex; align-items:center; gap:5px; padding:6px 15px; border:1px solid var(--line_regular,#e3e5e7); border-radius:16px; background:var(--bg1,#fff); color:var(--text1,#18191c); font-size:13px; cursor:pointer; transition:color .16s ease, border-color .16s ease; }
    .${NS}-undo svg{ width:15px; height:15px; }
    .${NS}-undo:hover{ color:var(--brand_blue,#00aeec); border-color:var(--brand_blue,#00aeec); }
    /* 轻量 toast：底部居中，跟随 B 站主题变量 */
    .${NS}-toast{ position:fixed; left:50%; bottom:44px; z-index:2147483000; transform:translateX(-50%) translateY(12px); max-width:76vw; padding:9px 16px; border-radius:8px; background:rgba(0,0,0,.82); color:#fff; font-size:13px; line-height:1.4; opacity:0; pointer-events:none; -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); transition:opacity .2s ease, transform .2s ease; }
    .${NS}-toast.on{ opacity:1; transform:translateX(-50%) translateY(0); }
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
