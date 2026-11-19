import { defineConfig } from 'vitest/config'

// Unit tests do not render CSS; keep the application Tailwind scanner out of workers.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], maxWorkers: 2 } })
