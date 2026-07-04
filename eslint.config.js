import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// 务实 lint：只抓真 bug（未用变量、不可达代码、重复键、self-assign 等），不做风格洁癖。
// 类型正确性交给 `tsc --noEmit`（typecheck），二者互补。集成/环境正确性另靠审查 + 真机。
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'test/**', 'references/**', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TS/tsc 已负责「未定义变量」——关掉 no-undef，省得再手列一堆浏览器 globals（window/document/…）
      'no-undef': 'off',
      // 本仓库网络 hook（net-hook/cdn-pick）刻意用 any 对付 B 站不定形响应，不视为问题
      '@typescript-eslint/no-explicit-any': 'off',
      // 未用变量降为 warn，且 _ 前缀视为「有意忽略」
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // 空 catch 是常见的「隐私模式/解析失败就放弃」兜底，允许
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 网络 hook 用 arguments 透明转发原 fetch/XHR/open，是正确惯用法，非 bug
      'prefer-rest-params': 'off',
    },
  },
)
