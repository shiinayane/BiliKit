/**
 * 「视频播放页」判定：video / 番剧 / 课程 / 播放列表 / 拜年祭等自带播放器的页。
 * 单一事实来源——两处依赖且必须一致，是同一条边界的正反面：
 *  - 回程(way-back) 只在这些页建「来时路」（靠站内 SPA 连续跳视频建栈）；
 *  - 全站抽屉(site-drawer) 恰在这些页「站下」不接管点击，好让点相关视频走原生 SPA、喂给回程。
 * 若两者用各自的正则、日后一改一漏，就会「抽屉在播放页又抢走点击 → 回程建不起来」。故共用此定义。
 * 注意按「点击/运行时」的 pathname 现读——B 站 SPA 跳转会改 location 而不重载。
 */
export function isPlayPage(pathname: string = location.pathname): boolean {
  return /^\/(video\/|bangumi\/play\/|cheese\/play\/|list\/|festival\/)/.test(pathname)
}
