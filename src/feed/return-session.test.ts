import { describe, expect, it } from 'vitest'
import { parseFeedReturnSession, saveFeedReturnSession, takeFeedReturnSession } from './return-session'
import type { FeedCard } from './app-api'

const card: FeedCard = {
  goto: 'av', title: '标题', up: 'UP', mid: '1', face: '', cover: 'https://example.com/cover.jpg',
  uri: '', bvid: 'BV1abc123456', aid: '1', cid: '2', param: '1', duration: '1:00', play: '1万',
  danmaku: '10', date: '', reason: '', dislikeReasons: [], source: 'app', trackId: '',
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('Feed 返回快照', () => {
  it('恢复并规范化游标与滚动位置', () => {
    const raw = JSON.stringify({
      version: 1, savedAt: 1_000, source: 'web', webFreshIdx: 3.9,
      exhausted: true, scrollY: -20, items: [card],
    })
    expect(parseFeedReturnSession(raw, 2_000)).toMatchObject({
      source: 'web', webFreshIdx: 3, exhausted: true, scrollY: 0, items: [card],
    })
  })

  it('拒绝过期、未来时间与损坏卡片', () => {
    const base = { version: 1, source: 'app', webFreshIdx: 1, exhausted: false, scrollY: 0, items: [card] }
    expect(parseFeedReturnSession(JSON.stringify({ ...base, savedAt: 0 }), 24 * 60 * 60 * 1000 + 1)).toBeNull()
    expect(parseFeedReturnSession(JSON.stringify({ ...base, savedAt: 70_001 }), 10_000)).toBeNull()
    expect(parseFeedReturnSession(JSON.stringify({ ...base, savedAt: 1_000, items: [{ title: '缺 bvid' }] }), 2_000)).toBeNull()
  })

  it('按标签页存储并一次性消费', () => {
    const storage = memoryStorage()
    expect(saveFeedReturnSession({
      source: 'app', webFreshIdx: 4, exhausted: false, scrollY: 800, items: [card],
    }, storage, 1_000)).toBe(true)
    expect(takeFeedReturnSession(2_000, storage)).toMatchObject({ webFreshIdx: 4, scrollY: 800 })
    expect(takeFeedReturnSession(2_000, storage)).toBeNull()
  })
})
