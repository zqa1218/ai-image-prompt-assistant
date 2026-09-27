import { spawn } from 'node:child_process'
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import {
  normalizeModels,
  normalizeUpstreamError,
  joinUrl,
  sendJson,
  sendText,
  upstreamHeaders,
} from './deepseek.mjs'
import { PROJECT_ROOT, resolveSettings, writeConfig, writeEnvKey } from './config.mjs'

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

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const route = `${req.method} ${url.pathname}`

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(res, url.pathname)
  }

  switch (route) {
    case 'GET /api/health':
      return sendJson(res, 200, { ok: true })

    case 'GET /api/settings': {
      const s = await resolveSettings()
      return sendJson(res, 200, {
        baseUrl: s.baseUrl,
        model: s.model,
        hasKey: s.hasKey,
        keySource: s.keySource,
      })
    }

    case 'PUT /api/settings': {
      const body = await readJsonBody(req)
      if (body === null) return sendJson(res, 400, { error: { message: '请求体不是合法 JSON' } })

      if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
        await writeEnvKey(body.apiKey.trim())
      }
      await writeConfig({
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
      })
      const s = await resolveSettings()
      return sendJson(res, 200, {
        baseUrl: s.baseUrl,
        model: s.model,
        hasKey: s.hasKey,
        keySource: s.keySource,
      })
    }

    case 'GET /api/models':
      return handleListModels(res)

    case 'POST /api/chat':
      return handleChat(req, res)

    default:
      return sendJson(res, 404, { error: { message: `未知路由 ${route}` } })
  }
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

async function handleListModels(res) {
  const settings = await resolveSettings()
  if (!settings.apiKey) {
    return sendJson(res, 401, {
      error: { message: '尚未配置 API Key，请先在设置页填写' },
    })
  }

  let upstream
  try {
    upstream = await fetch(joinUrl(settings.baseUrl, 'models'), {
      headers: upstreamHeaders(settings.apiKey),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    return sendJson(res, 502, {
      error: { message: `无法连接上游（${settings.baseUrl}）：${describe(err)}` },
    })
  }

  if (!upstream.ok) {
    return sendJson(res, upstream.status, await normalizeUpstreamError(upstream))
  }

  const payload = await upstream.json().catch(() => null)
  if (!payload) {
    return sendJson(res, 502, { error: { message: '上游返回的不是合法 JSON' } })
  }
  return sendJson(res, 200, normalizeModels(payload))
}

async function handleChat(req, res) {
  const settings = await resolveSettings()
  if (!settings.apiKey) {
    return sendJson(res, 401, {
      error: { message: '尚未配置 API Key，请先在设置页填写' },
    })
  }

  const body = await readJsonBody(req)
  if (body === null || typeof body !== 'object') {
    return sendJson(res, 400, { error: { message: '请求体不是合法 JSON' } })
  }

  const wantsStream = body.stream === true
  const payload = { ...body, model: body.model ?? settings.model }

  let upstream
  try {
    upstream = await fetch(joinUrl(settings.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: upstreamHeaders(settings.apiKey),
      body: JSON.stringify(payload),
      signal: wantsStream ? undefined : AbortSignal.timeout(180_000),
    })
  } catch (err) {
    return sendJson(res, 502, {
      error: { message: `无法连接上游（${settings.baseUrl}）：${describe(err)}` },
    })
  }

  if (!upstream.ok) {
    return sendJson(res, upstream.status, await normalizeUpstreamError(upstream))
  }

  if (wantsStream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    if (!upstream.body) return res.end()
    Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res)
    return
  }

  const text = await upstream.text()
  return sendText(res, 200, text)
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

server.listen(PORT, HOST, () => {
  console.log(`[prompt-wizard] 服务已启动：http://${HOST}:${PORT}`)
  if (process.env.PW_OPEN_BROWSER === '1') {
    openBrowser(`http://${HOST}:${PORT}/`)
  }
})
