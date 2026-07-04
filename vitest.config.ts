import { defineConfig } from 'vitest/config'

// 只测「纯逻辑」层：URL/参数解析、签名、命中判定、栈运算等——不碰 DOM/网络/GM。
// 测试与源码同放（src/**/*.test.ts）。集成/环境正确性靠审查 agent + 真机，不在此列。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
