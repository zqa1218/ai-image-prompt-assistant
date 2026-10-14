import { spawn } from 'node:child_process'
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { sendJson, sendText, joinUrl, upstreamHeaders, normalizeUpstreamError } from './deepseek.mjs'
import { PROJECT_ROOT, publicSettings, readSettings, updateSettings } from './config.mjs'
import {
  attachPhotoshopBridge,
  captureFromPhotoshop,
  photoshopStatus,
} from './photoshop-bridge.mjs'
import {
  captureViaPhotoshopCom,
  listPhotoshopDocuments,
  photoshopProcessRunning,
} from './photoshop-com.mjs'

/**
 * 监听端口。两种运行方式对端口的叫法不同：
 * - 开发：Vite 跑在 PW_WEB_PORT，并把 /api 代理到 PW_API_PORT
 * - 发布包：同一个进程既托管前端又提供接口，只用 PW_WEB_PORT
 * 因此优先看 PW_API_PORT，其次 PW_WEB_PORT。
 */
const PORT = Number(
  process.env.PW_API_PORT ?? process.env.PW_WEB_PORT ?? process.env.PORT ?? 8787,
)
const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 60 * 1024 * 1024
let activeChats = 0

/** 生产包靠这里托管前端；开发时前端走 Vite，这个目录可能不存在或已过期。 */
const DIST_DIR = path.join(PROJECT_ROOT, 'dist')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    sendJson(res, 500, {
      error: { message: err instanceof Error ? err.message : String(err), type: 'internal' },
    })
  })
})

await attachPhotoshopBridge(server, PORT)

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const route = `${req.method} ${url.pathname}`

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(res, url.pathname)
  }

  const localOrigins = [PORT, Number(process.env.PW_WEB_PORT || 5173), Number(process.env.PW_WEB_PORT || 5173) + 1000]
    .flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  if (req.headers.origin && !localOrigins.includes(req.headers.origin)) {
    return sendJson(res, 403, { error: { message: '拒绝非本机助手页面的请求' } })
  }
  if (['POST', 'PUT'].includes(req.method) && !req.headers['content-type']?.startsWith('application/json')) {
    return sendJson(res, 415, { error: { message: '仅接受 JSON 请求' } })
  }

  switch (route) {
    case 'GET /api/health':
      return sendJson(res, 200, { ok: true })

    case 'GET /api/settings': {
      return sendJson(res, 200, publicSettings())
    }

    case 'PUT /api/settings': {
      if (activeChats) return sendJson(res, 409, { error: { message: '模型正在回复，请完成后再切换模式或修改配置' } })
      try { return sendJson(res, 200, updateSettings(await readJsonBody(req))) }
      catch (error) { return sendJson(res, 400, { error: { message: describe(error) } }) }
    }

    case 'GET /api/models':
      return sendJson(res, 200, { models: [{ id: 'gemini-web', name: 'Gemini 4 Argon 网页', supportsVision: true }, { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', supportsVision: true }] })

    case 'POST /api/gemini/reset': {
      const body = await readJsonBody(req)
      if (typeof body?.conversationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.conversationId)) return sendJson(res, 400, { error: { message: '缺少有效的图片对话标识' } })
      if (!globalThis.promptWizardGeminiWeb) return sendJson(res, 503, { error: { message: '请启动桌面端' } })
      await globalThis.promptWizardGeminiWeb.resetConversation(body.conversationId)
      return sendJson(res, 200, { ok: true })
    }

    case 'GET /api/gemini/status':
      return handleGeminiStatus(res)

    case 'POST /api/gemini/open':
      return handleGeminiOpen(req, res)

    case 'POST /api/chat':
      activeChats += 1
      try { return await handleChat(req, res) }
      finally { activeChats -= 1 }

    case 'GET /api/photoshop/status':
      return handlePhotoshopStatus(res)

    case 'GET /api/photoshop/documents':
      return handlePhotoshopDocuments(res)

    case 'POST /api/photoshop/capture':
      return handlePhotoshopCapture(req, res)

    default:
      return sendJson(res, 404, { error: { message: `未知路由 ${route}` } })
  }
}

/**
 * Photoshop 有两条连接通道：
 * - uxp：装了 Photoshop 面板插件，插件主动连回本服务（面板方式）
 * - com：不装任何插件，直接用 Photoshop 自带的 COM 自动化导出画布
 * 两条都不需要打开 UXP Developer Tools。
 */
async function handlePhotoshopStatus(res) {
  if (photoshopStatus().connected) {
    return sendJson(res, 200, {
      connected: true,
      mode: 'uxp',
      detail: '已通过 Photoshop 面板连接',
    })
  }
  if (await photoshopProcessRunning()) {
    return sendJson(res, 200, {
      connected: true,
      mode: 'com',
      detail: '已检测到 Photoshop，可直接读取画布',
    })
  }
  return sendJson(res, 200, {
    connected: false,
    mode: 'none',
    detail: '没检测到 Photoshop，请先打开 Photoshop',
  })
}

async function handlePhotoshopDocuments(res) {
  if (!(await photoshopProcessRunning())) {
    return sendJson(res, 200, { documents: [] })
  }
  try {
    return sendJson(res, 200, { documents: await listPhotoshopDocuments() })
  } catch (err) {
    return sendJson(res, 200, { documents: [], error: describe(err) })
  }
}

async function handlePhotoshopCapture(req, res) {
  const body = await readJsonBody(req)
  const role = body?.role === 'reference' ? 'reference' : 'original'
  const index = Number.isInteger(body?.index) ? body.index : -1

  if (photoshopStatus().connected) {
    return sendJson(res, 200, { image: await captureFromPhotoshop(role), source: 'uxp' })
  }

  if (!(await photoshopProcessRunning())) {
    return sendJson(res, 503, {
      error: { message: '没有检测到 Photoshop，请先打开 Photoshop 并打开一张图' },
    })
  }

  return sendJson(res, 200, {
    image: await captureViaPhotoshopCom({ role, index }),
    source: 'com',
  })
}

/**
 * 静态托管 dist。找不到实体文件时回退到 index.html，
 * 让前端的路由自行处理（本应用只有一个页面，回退是兜底）。
 */
function serveStatic(res, pathname) {
  const root = path.resolve(DIST_DIR)
  if (!existsSync(root)) {
    return sendText(
      res,
      503,
      '前端尚未构建。\n开发时请用 npm run dev（前端走 Vite），\n或先执行 npm run build 生成 dist。\n',
      'text/plain; charset=utf-8',
    )
  }

  let relative = '/index.html'
  if (pathname !== '/' && pathname !== '') {
    try {
      relative = decodeURIComponent(pathname)
    } catch {
      relative = pathname
    }
  }

  const resolved = path.resolve(root, `.${path.posix.normalize(relative)}`)
  // 防目录穿越：解析后的路径必须仍在 dist 之内
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return sendText(res, 403, 'Forbidden', 'text/plain; charset=utf-8')
  }

  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return streamFile(res, resolved)
  }

  const index = path.join(root, 'index.html')
  if (existsSync(index)) return streamFile(res, index)
  return sendText(res, 404, 'Not Found', 'text/plain; charset=utf-8')
}

function streamFile(res, filePath) {
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const size = statSync(filePath).size
  res.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'cache-control': 'no-cache',
  })
  createReadStream(filePath).pipe(res)
}

async function handleChat(req, res) {
  const body = await readJsonBody(req)
  if (body === null || typeof body !== 'object' || !Array.isArray(body.messages) || !body.messages.length) {
    return sendJson(res, 400, { error: { message: '请求体不是合法 JSON' } })
  }
  const settings = readSettings()
  if (settings.mode === 'api') {
    if (!settings.apiKey) return sendJson(res, 400, { error: { message: '请先在设置中填写 API Key（Gemini Pro 会员不包含 DeepSeek API）' } })
    const upstreamBody = { model: settings.model, messages: body.messages, stream: false }
    for (const key of ['thinking', 'reasoning_effort', 'temperature', 'response_format', 'max_tokens']) {
      if (body[key] !== undefined) upstreamBody[key] = body[key]
    }
    const upstream = await fetch(joinUrl(settings.baseUrl, 'chat/completions'), {
      method: 'POST', headers: upstreamHeaders(settings.apiKey), body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(180000), redirect: 'error',
    })
    if (!upstream.ok) return sendJson(res, upstream.status, await normalizeUpstreamError(upstream))
    return sendJson(res, 200, await upstream.json())
  }
  const bridge = globalThis.promptWizardGeminiWeb
  if (!bridge) {
    return sendJson(res, 503, {
      error: { message: 'Gemini 网页桥接仅在桌面端可用，请启动桌面版助手' },
    })
  }
  // 网页方案（模型尝试链 + 对话/任务 + 思考等级）由设置决定，插件里不再写死 Argon。
  const content = await bridge.submit({ ...body, geminiPlan: settings.geminiPlan, geminiThinking: settings.geminiThinking })
  return sendJson(res, 200, {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })
}

async function handleGeminiStatus(res) {
  const bridge = globalThis.promptWizardGeminiWeb
  if (!bridge) {
    return sendJson(res, 200, {
      connected: false,
      detail: '请启动桌面版助手以使用 Gemini 网页桥接',
    })
  }
  return sendJson(res, 200, await bridge.status())
}

async function handleGeminiOpen(req, res) {
  const bridge = globalThis.promptWizardGeminiWeb
  if (!bridge) {
    return sendJson(res, 503, { error: { message: '请启动桌面版助手' } })
  }
  const body = await readJsonBody(req)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  return sendJson(res, 200, email ? await bridge.openLogin(email) : await bridge.openLogin())
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw new Error('请求体超过 60 MB 上限')
    }
    chunks.push(chunk)
  }
  if (size === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function describe(err) {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return '请求超时'
    return err.message
  }
  return String(err)
}

/**
 * 发布包用 PW_OPEN_BROWSER=1 让服务端在监听成功后自己打开浏览器。
 * 比在批处理里 sleep 一个猜测值可靠：这里明确知道端口已经开始监听。
 */
function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
    console.log(`[prompt-wizard] 已在浏览器打开 ${url}`)
  } catch {
    console.log(`[prompt-wizard] 自动打开浏览器失败，请手动访问 ${url}`)
  }
}

/**
 * 端口被占用是最常见的启动失败原因（重复启动），
 * 直接抛 Node 堆栈用户看不懂，这里换成能照做的提示。
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[prompt-wizard] 端口 ${PORT} 已被占用，可能已经有一个实例在运行。`)
    console.error(`[prompt-wizard] 已经在运行的话，直接打开 http://${HOST}:${PORT}/ 即可；`)
    console.error(`[prompt-wizard] 想重开一个，请先关掉正在运行的那个窗口。`)
  } else {
    console.error(`[prompt-wizard] 启动失败：${err.message}`)
  }
  process.exit(1)
})

export const ready = new Promise((resolve) => {
  server.listen(PORT, HOST, () => {
    console.log(`[prompt-wizard] 服务已启动：http://${HOST}:${PORT}`)
    if (process.env.PW_OPEN_BROWSER === '1') openBrowser(`http://${HOST}:${PORT}/`)
    resolve()
  })
})
