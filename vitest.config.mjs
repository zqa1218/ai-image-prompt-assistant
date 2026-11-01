// 单元测试不需要 React/Tailwind 构建插件，避免 CSS 扫描阻塞测试启动。
export default {
  test: { pool: 'threads', maxWorkers: 2, exclude: ['**/node_modules/**', '**/release*/**'] },
}
