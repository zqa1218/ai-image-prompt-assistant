import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 端口可用环境变量覆盖，便于测试或与已运行的 dev 服务并存
const apiPort = process.env.PW_API_PORT ?? '8787'
const webPort = Number(process.env.PW_WEB_PORT ?? 5173)

const apiProxy = {
  '/api': {
    target: `http://127.0.0.1:${apiPort}`,
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    proxy: apiProxy,
  },
  preview: {
    port: webPort + 1000,
    proxy: apiProxy,
  },
})
