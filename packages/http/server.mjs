import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TaskStore, taskStatus, renameWithRetry } from '../storage/store.mjs';
import { findStoredImage, imageInfo, saveImage, verifyAsset } from '../storage/assets.mjs';
import { MJ_CAPABILITIES } from '../core/mj-capabilities.mjs';
import { WorkbenchError, requireThat } from '../core/validation.mjs';
import { fromPromptWizard } from '../adapters/prompt-wizard.mjs';
import { importExchange, exportWizardContext, EXCHANGE_LIMIT } from '../adapters/prompt-wizard-exchange.mjs';
import { validatePlaceRequest } from '../adapters/photoshop.mjs';

const STATIC_ROOT = fileURLToPath(new URL('../../apps/studio/', import.meta.url));
// One version source: the root package.json (electron-builder rewrites it with the desktop build version when packaging).
export const WORKBENCH_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version ?? 'unknown'; }
  catch { return 'unknown'; }
})();
const JSON_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 30 * 1024 * 1024;
const MUTATION_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
const safeEqual = (a, b) => {
  const left = Buffer.from(a ?? ''), right = Buffer.from(b ?? '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const cleanName = value => {
  let name;
  try { name = decodeURIComponent(String(value ?? '')); } catch { throw new WorkbenchError('INVALID_FILENAME', '文件名编码无效'); }
  requireThat(name.length > 0 && name.length <= 255 && !/[\\/\0\r\n]/.test(name), 'INVALID_FILENAME', '文件名无效');
  return name;
};
function sendJson(res, status, body, extra = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': data.length, ...extra });
  res.end(data);
}
function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  requireThat(!Number.isFinite(declared) || declared <= limit, 'BODY_TOO_LARGE', `请求不能超过 ${Math.floor(limit / 1024 / 1024)} MiB`);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) { done = true; reject(new WorkbenchError('BODY_TOO_LARGE', `请求不能超过 ${Math.floor(limit / 1024 / 1024)} MiB`)); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks)); });
    req.on('error', error => { if (!done) reject(error); });
  });
}
async function readJson(req, limit = JSON_LIMIT) {
  requireThat(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 'UNSUPPORTED_MEDIA_TYPE', '此接口仅接受 application/json');
  const raw = await readBody(req, limit);
  try { return { raw, value: JSON.parse(raw.toString('utf8')) }; }
  catch { throw new WorkbenchError('INVALID_JSON', 'JSON 格式无效'); }
}
function errorStatus(error) {
  if (error.code === 'BODY_TOO_LARGE') return 413;
  if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return 415;
  if (['TASK_NOT_FOUND', 'REVISION_NOT_FOUND', 'RESULT_NOT_FOUND', 'UPLOAD_NOT_FOUND', 'NOT_FOUND'].includes(error.code)) return 404;
  if (['ORIGIN_REJECTED', 'CSRF_REJECTED'].includes(error.code)) return 403;
  if (error.code === 'LOCK_OWNER_ALIVE') return 409;
  if (error.code === 'INVALID_HOST') return 421;
  if (error.code === 'METHOD_NOT_ALLOWED') return 405;
  if (error.code === 'PS_TIMEOUT') return 504;
  if (['PS_BRIDGE_UNAVAILABLE', 'PS_CAPABILITY_UNAVAILABLE', 'PS_DISCONNECTED'].includes(error.code)) return 503;
  if (['PS_SESSION_CHANGED', 'PS_DOCUMENT_CHANGED', 'PS_DOCUMENT_RENAMED', 'PS_CANVAS_CHANGED', 'PS_SELECTION_CHANGED', 'PS_REQUEST_IN_FLIGHT'].includes(error.code)) return 409;
  if (['TASK_EXISTS', 'REVISION_CONFLICT', 'REQUEST_KEY_CONFLICT', 'IDEMPOTENCY_KEY_CONFLICT', 'OUTPUT_EXISTS', 'STORE_LOCKED'].includes(error.code)) return 409;
  if (error instanceof WorkbenchError) return 400;
  return 500;
}
function summary(task) {
  const current = task.revisions[task.head - 1];
  return { taskId: task.taskId, revision: task.head, mode: current.mode, operation: current.operation, prompt: current.prompt.text, updatedAt: current.createdAt, status: taskStatus(task), runs: task.runs.length, results: task.results.length };
}
function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}
class IdempotencyLedger {
  constructor(root) {
    this.file = path.join(root, 'api-idempotency.json');
    this.records = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    requireThat(Array.isArray(this.records), 'STORE_CORRUPTED', 'API 幂等记录损坏');
  }
  find(key) { return this.records.find(record => record.key === key); }
  save(record) {
    this.records.push(record);
    if (this.records.length > 500) this.records.splice(0, this.records.length - 500);
    atomicJson(this.file, this.records);
  }
}

export function createWorkbenchServer({ dataRoot, host = '127.0.0.1', port = 8790, connectorFile = null, photoshopBridge = null } = {}) {
  requireThat(dataRoot, 'DATA_ROOT_REQUIRED', '必须指定独立数据目录');
  const store = new TaskStore(dataRoot);
  const ledger = new IdempotencyLedger(store.root);
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const integrationToken = crypto.randomBytes(32).toString('base64url');
  const exportRoot = path.join(store.root, 'exports');
  fs.mkdirSync(exportRoot, { recursive: true });
  let mutationQueue = Promise.resolve();
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      const status = errorStatus(error);
      if (!res.headersSent) sendJson(res, status, { error: { code: error.code ?? 'INTERNAL_ERROR', message: status === 500 ? '本地服务发生未预期错误，请查看终端日志' : error.message } });
      if (status === 500) console.error('[studio]', error);
    });
  });
  const addressPort = () => server.address()?.port ?? port;
  const allowedHost = value => [`127.0.0.1:${addressPort()}`, `localhost:${addressPort()}`].includes(String(value).toLowerCase());
  const allowedOrigin = value => !value || [`http://127.0.0.1:${addressPort()}`, `http://localhost:${addressPort()}`].includes(value);
  async function mutate(req, res, url, raw, action, successStatus = 200) {
    const key = req.headers['idempotency-key'];
    requireThat(typeof key === 'string' && MUTATION_KEY.test(key), 'IDEMPOTENCY_KEY_REQUIRED', '写操作必须提供 8–128 位 Idempotency-Key');
    const signature = hash(Buffer.concat([Buffer.from(`${req.method}\0${url.pathname}\0`), raw]));
    const execute = async () => {
      const existing = ledger.find(key);
      if (existing) {
        requireThat(existing.signature === signature, 'IDEMPOTENCY_KEY_CONFLICT', '该 Idempotency-Key 已用于另一请求');
        return sendJson(res, existing.status, existing.body, { 'idempotency-replayed': 'true' });
      }
      const body = await action();
      const record = { key, signature, status: successStatus, body, recordedAt: new Date().toISOString() };
      ledger.save(record);
      return sendJson(res, successStatus, body);
    };
    const pending = mutationQueue.then(execute, execute);
    mutationQueue = pending.catch(() => {});
    return pending;
  }
  async function handle(req, res) {
    requireThat(allowedHost(req.headers.host), 'INVALID_HOST', '仅允许本机工作台 Host');
    requireThat(allowedOrigin(req.headers.origin), 'ORIGIN_REJECTED', '拒绝非本机工作台页面的请求');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        const connectorRequest = url.pathname === '/api/integrations/prompt-wizard/tasks';
        const supplied = connectorRequest ? req.headers['x-workbench-integration'] : req.headers['x-workbench-csrf'];
        requireThat(safeEqual(supplied, connectorRequest ? integrationToken : csrfToken), 'CSRF_REJECTED', connectorRequest ? 'Prompt Wizard 连接令牌无效，请重启两个本机应用' : '页面令牌已过期，请刷新工作台');
      }
      return handleApi(req, res, url);
    }
    requireThat(['GET', 'HEAD'].includes(req.method), 'METHOD_NOT_ALLOWED', '静态资源仅支持读取');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    requireThat(['index.html', 'app.js', 'revision-state.js', 'styles.css'].includes(relative), 'NOT_FOUND', '页面不存在');
    const file = path.join(STATIC_ROOT, relative);
    const data = fs.readFileSync(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME[path.extname(file)], 'cache-control': 'no-store', 'content-length': data.length });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  }
  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).map(part => {
      try { return decodeURIComponent(part); } catch { throw new WorkbenchError('INVALID_PATH', '请求路径编码无效'); }
    });
    if (req.method === 'GET' && url.pathname === '/api/meta') return sendJson(res, 200, { version: WORKBENCH_VERSION, csrfToken, mode: 'local', officialCreateUrl: 'https://www.midjourney.com/imagine', capabilities: MJ_CAPABILITIES, limits: { imageBytes: IMAGE_LIMIT, jsonBytes: JSON_LIMIT, mjUploadBytes: 10 * 1024 * 1024 } });
    if (req.method === 'GET' && url.pathname === '/api/tasks') return sendJson(res, 200, { tasks: store.read().tasks.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    if (req.method === 'GET' && url.pathname === '/api/store/status') return sendJson(res, 200, { lock: store.lockStatus() });
    if (req.method === 'GET' && url.pathname === '/api/photoshop/status') return sendJson(res, 200, photoshopBridge?.status() ?? { connected: false, mode: 'none', capabilities: [] });
    if (req.method === 'GET' && url.pathname === '/api/photoshop/documents') {
      requireThat(photoshopBridge?.status().connected, 'PS_BRIDGE_UNAVAILABLE', '未连接 Photoshop UXP 面板');
      return sendJson(res, 200, { documents: await photoshopBridge.listDocuments() });
    }
    if (req.method === 'GET' && parts[1] === 'tasks' && parts.length === 3) {
      const task = store.get(parts[2]); return sendJson(res, 200, { task, status: taskStatus(task) });
    }
    if (req.method === 'GET' && parts[1] === 'assets' && parts.length === 3) {
      const image = findStoredImage(store.root, parts[2]);
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': image.mediaType, 'content-length': image.bytes, 'cache-control': 'private, max-age=31536000, immutable' });
      return fs.createReadStream(path.join(store.root, image.path)).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/api/uploads') {
      const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
      requireThat(['image/png', 'image/jpeg', 'image/webp'].includes(type), 'UNSUPPORTED_MEDIA_TYPE', '仅接受 PNG、JPEG 或 WebP 图片');
      const raw = await readBody(req, IMAGE_LIMIT);
      return mutate(req, res, url, raw, () => {
        const info = imageInfo(raw); requireThat(info.mediaType === type, 'MEDIA_TYPE_MISMATCH', '声明的图片类型与实际内容不一致');
        const saved = saveImage(store.root, { data: raw, ...info });
        return { upload: { sha256: saved.sha256, originalName: cleanName(req.headers['x-file-name']), ...saved } };
      }, 201);
    }
    if (req.method === 'GET' && parts[1] === 'tasks' && parts[3] === 'wizard-context' && parts.length === 4) {
      return sendJson(res, 200, exportWizardContext(store, parts[2], Number(url.searchParams.get('revision'))));
    }
    const exchangeRoute = ['/api/tasks/import-prompt', '/api/integrations/prompt-wizard/tasks'].includes(url.pathname);
    const { raw, value: body } = await readJson(req, exchangeRoute ? EXCHANGE_LIMIT : JSON_LIMIT);
    if (req.method === 'POST' && url.pathname === '/api/store/recover-lock') return mutate(req, res, url, raw, () => store.recoverLock());
    if (req.method === 'POST' && url.pathname === '/api/tasks') return mutate(req, res, url, raw, () => ({ task: store.create(body.input, store.root) }), 201);
    if (req.method === 'POST' && exchangeRoute) return mutate(req, res, url, raw, () => ({ task: body.exchange ? importExchange(store, body.exchange, body.mode) : store.create(fromPromptWizard(body.artifact, body.mode), store.root) }), 201);
    if (req.method === 'PUT' && parts[1] === 'tasks' && parts.length === 3) return mutate(req, res, url, raw, () => ({ task: store.revise(parts[2], body.expectedRevision, body.input, store.root) }));
    if (req.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'confirm' && parts.length === 4) return mutate(req, res, url, raw, () => ({ snapshot: store.confirm(parts[2], body.revision, body.reviews) }));
    if (req.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'handoff' && parts.length === 4) return mutate(req, res, url, raw, () => {
      const directory = path.join(exportRoot, `${parts[2]}-r${body.revision}-handoff-${Date.now()}-${randomUUID().slice(0, 8)}`);
      return { export: store.export(parts[2], body.revision, directory, { handoff: true }), handoff: store.handoff(parts[2], body.revision) };
    });
    if (req.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'submissions' && parts.length === 4) return mutate(req, res, url, raw, () => ({ run: store.recordSubmission(parts[2], body.revision, body.requestKey, body.websiteUrl ?? null) }), 201);
    if (req.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'results' && parts[4] === 'import' && parts.length === 5) return mutate(req, res, url, raw, () => ({ results: store.importStoredResults(parts[2], body.revision, body.runId, body.uploads) }), 201);
    if (req.method === 'PUT' && parts[1] === 'tasks' && parts[3] === 'results' && parts.length === 5) return mutate(req, res, url, raw, () => ({ result: store.select(parts[2], parts[4], body.selected) }));
    if (req.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'results' && parts[5] === 'place' && parts.length === 6) return mutate(req, res, url, raw, async () => {
      requireThat(photoshopBridge?.status().connected, 'PS_BRIDGE_UNAVAILABLE', '未连接 Photoshop UXP 面板；COM 通道只读，不能回传结果');
      const task = store.get(parts[2]), snapshot = store.revision(task, body.revision, true);
      const result = task.results.find(item => item.resultId === parts[4] && item.revision === body.revision);
      requireThat(result, 'RESULT_NOT_FOUND', '当前任务版本中没有此结果');
      requireThat(body.placement === 'new_document' || snapshot.photoshopContext, 'PS_CONTEXT_REQUIRED', '此任务没有 Photoshop 来源上下文，只能新建文档');
      const image = verifyAsset(store.root, result);
      const request = validatePlaceRequest({
        requestId: body.requestId, placement: body.placement, context: snapshot.photoshopContext,
        layerName: `AI结果 ${result.originalName.replace(/\.[^.]+$/, '')}`.slice(0, 255),
        sourceWidth: result.width, sourceHeight: result.height,
        dataUrl: `data:${result.mediaType};base64,${image.data.toString('base64')}`,
      });
      return { placement: await photoshopBridge.place(request) };
    });
    if (req.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'exports' && parts.length === 4) return mutate(req, res, url, raw, () => {
      const kind = body.promptOnly ? 'prompt' : body.runId ? 'results' : 'package';
      const directory = path.join(exportRoot, `${parts[2]}-r${body.revision}-${kind}-${Date.now()}-${randomUUID().slice(0, 8)}`);
      return { export: store.export(parts[2], body.revision, directory, { promptOnly: Boolean(body.promptOnly), runId: body.runId ?? null }) };
    });
    throw new WorkbenchError('NOT_FOUND', '接口不存在');
  }
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      if (connectorFile) {
        fs.mkdirSync(path.dirname(connectorFile), { recursive: true });
        const temporary = `${connectorFile}.${randomUUID()}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, url: `http://${host}:${addressPort()}`, token: integrationToken, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        renameWithRetry(temporary, connectorFile);
      }
      resolve();
    });
  });
  const close = () => new Promise((resolve, reject) => {
    server.close(error => {
      if (error) return reject(error);
      if (connectorFile) {
        try { const current = JSON.parse(fs.readFileSync(connectorFile, 'utf8')); if (safeEqual(current.token, integrationToken)) fs.unlinkSync(connectorFile); } catch { /* absent or replaced by a newer process */ }
      }
      try { photoshopBridge?.close?.(); } catch {}
      resolve();
    });
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
  return { server, store, ready, connectorFile, get port() { return addressPort(); }, get url() { return `http://${host}:${addressPort()}`; }, close };
}
