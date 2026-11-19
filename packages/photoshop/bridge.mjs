import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { WorkbenchError, requireThat } from '../core/validation.mjs';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function compareVersions(left = '0.0.0', right = '0.0.0') {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  return 0;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}

export class PhotoshopBridge {
  constructor({ descriptorFile, pathname = '/ps-bridge', timeoutMs = 30_000, maxPayload = 32 * 1024 * 1024 } = {}) {
    requireThat(typeof descriptorFile === 'string' && path.isAbsolute(descriptorFile), 'PS_DESCRIPTOR_REQUIRED', 'Photoshop 桥描述文件必须是绝对路径');
    this.descriptorFile = descriptorFile;
    this.pathname = pathname;
    this.timeoutMs = timeoutMs;
    this.maxPayload = maxPayload;
    this.token = crypto.randomBytes(32).toString('base64url');
    this.clients = new Set();
    this.plugin = null;
    this.pending = new Map();
    this.documentsPromise = null;
    this.mutationQueue = Promise.resolve();
    this.wss = null;
  }

  attach(server, port) {
    requireThat(!this.wss, 'PS_BRIDGE_ATTACHED', 'Photoshop 桥不能重复挂载');
    const wss = new WebSocketServer({ noServer: true, maxPayload: this.maxPayload });
    this.wss = wss;
    server.on('upgrade', (request, socket, head) => {
      let url;
      try { url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`); } catch { socket.destroy(); return; }
      if (!LOOPBACK.has(socket.remoteAddress) || url.pathname !== this.pathname || url.searchParams.get('token') !== this.token) {
        socket.destroy(); return;
      }
      wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
    });
    wss.on('connection', ws => this.#connect(ws));
    atomicJson(this.descriptorFile, { schemaVersion: 2, host: '127.0.0.1', port, pathname: this.pathname, token: this.token, pid: process.pid, updatedAt: new Date().toISOString() });
    return this;
  }

  status() {
    const plugin = this.plugin;
    return plugin?.readyState === 1
      ? { connected: true, mode: 'uxp', sessionId: plugin.photoshopSessionId, version: plugin.promptWizardVersion, capabilities: [...plugin.photoshopCapabilities] }
      : { connected: false, mode: 'none', capabilities: [] };
  }

  listDocuments() {
    if (this.documentsPromise) return this.documentsPromise;
    this.documentsPromise = this.request('documents', {}).finally(() => { this.documentsPromise = null; });
    return this.documentsPromise;
  }

  capture(payload) { return this.request('capture', payload); }

  place(payload) {
    const execute = () => this.request('place', payload, { requestId: payload.requestId });
    const pending = this.mutationQueue.then(execute, execute);
    this.mutationQueue = pending.catch(() => {});
    return pending;
  }

  request(operation, payload, { requestId = crypto.randomUUID() } = {}) {
    const plugin = this.plugin;
    requireThat(plugin?.readyState === 1, 'PS_BRIDGE_UNAVAILABLE', '未连接 Photoshop UXP 面板');
    requireThat(REQUEST_ID.test(requestId), 'PS_REQUEST_ID', 'Photoshop 请求标识无效');
    requireThat(plugin.photoshopCapabilities.has(operation), 'PS_CAPABILITY_UNAVAILABLE', `Photoshop 面板不支持 ${operation}`);
    requireThat(!this.pending.has(requestId), 'PS_REQUEST_IN_FLIGHT', '同一 Photoshop 请求正在执行');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new WorkbenchError('PS_TIMEOUT', `Photoshop ${operation} 操作超时，可安全重试同一请求`));
      }, this.timeoutMs);
      this.pending.set(requestId, { operation, plugin, resolve, reject, timer });
      try {
        plugin.send(JSON.stringify({ type: 'request', requestId, operation, payload, sessionId: plugin.photoshopSessionId }));
      } catch (error) {
        clearTimeout(timer); this.pending.delete(requestId); reject(new WorkbenchError('PS_DISCONNECTED', error.message));
      }
    });
  }

  close() {
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new WorkbenchError('PS_DISCONNECTED', 'Photoshop 桥已关闭')); }
    this.pending.clear();
    for (const client of this.clients) try { client.close(); } catch {}
    this.clients.clear(); this.plugin = null;
    if (this.wss) this.wss.close();
    this.wss = null;
    try {
      const current = JSON.parse(fs.readFileSync(this.descriptorFile, 'utf8'));
      if (current.token === this.token) fs.unlinkSync(this.descriptorFile);
    } catch {}
  }

  #connect(ws) {
    ws.promptWizardVersion = '0.0.0';
    ws.photoshopSessionId = null;
    ws.photoshopCapabilities = new Set();
    this.clients.add(ws);
    ws.on('message', raw => this.#receive(raw, ws));
    const remove = () => {
      this.clients.delete(ws);
      for (const [id, task] of this.pending) if (task.plugin === ws) {
        clearTimeout(task.timer); this.pending.delete(id); task.reject(new WorkbenchError('PS_DISCONNECTED', 'Photoshop 面板连接已断开'));
      }
      this.#choosePlugin();
    };
    ws.on('close', remove); ws.on('error', remove);
    ws.send(JSON.stringify({ type: 'hello', protocol: 'photoshop-bridge/2' }));
  }

  #receive(raw, ws) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message?.type === 'pluginHello') {
      if (typeof message.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(message.version) || typeof message.sessionId !== 'string' || !REQUEST_ID.test(message.sessionId) || !Array.isArray(message.capabilities)) return;
      const capabilities = message.capabilities.filter(value => ['documents', 'capture', 'place'].includes(value));
      if (!capabilities.includes('documents') || !capabilities.includes('capture')) return;
      ws.promptWizardVersion = message.version;
      ws.photoshopSessionId = message.sessionId;
      ws.photoshopCapabilities = new Set(capabilities);
      this.#choosePlugin();
      return;
    }
    if (message?.type !== 'response' || typeof message.requestId !== 'string') return;
    const task = this.pending.get(message.requestId);
    if (!task || task.plugin !== ws) return;
    clearTimeout(task.timer); this.pending.delete(message.requestId);
    if (message.sessionId !== ws.photoshopSessionId) return task.reject(new WorkbenchError('PS_SESSION_CHANGED', 'Photoshop 会话在操作期间发生变化'));
    if (message.ok !== true) return task.reject(new WorkbenchError(typeof message.error?.code === 'string' ? message.error.code : 'PS_OPERATION_FAILED', String(message.error?.message || 'Photoshop 操作失败')));
    task.resolve(message.result);
  }

  #choosePlugin() {
    const ready = [...this.clients].filter(ws => ws.readyState === 1 && ws.photoshopSessionId);
    ready.sort((a, b) => compareVersions(b.promptWizardVersion, a.promptWizardVersion));
    this.plugin = ready[0] ?? null;
  }
}
