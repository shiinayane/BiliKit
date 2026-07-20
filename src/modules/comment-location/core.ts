export type CommentSex = '男' | '女'

const PROFILE_ICON_BASE = 'https://i0.hdslb.com/bfs/seed/jinkela/short/webui/user-profile/img/'

/** B 站评论 reply.member.sex：仅公开男/女；“保密”及异常值不显示。 */
export function normalizeCommentSex(value: unknown): CommentSex | null {
  return value === '男' || value === '女' ? value : null
}

/** 与评论头像悬停卡片共用同一组 B 站静态图标。 */
export function commentSexIconUrl(sex: CommentSex): string {
  return `${PROFILE_ICON_BASE}gender_${sex === '男' ? 'male' : 'female'}.png@.avif`
}
