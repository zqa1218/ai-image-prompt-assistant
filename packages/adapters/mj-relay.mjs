import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { imageInfo, saveImage } from '../storage/assets.mjs';
import { renameWithRetry } from '../storage/store.mjs';

const jobPath = /^\/jobs\/([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})\/?$/i;
export function jobIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://www.midjourney.com' && !url.username && !url.password) return jobPath.exec(url.pathname)?.[1].toLowerCase() ?? null;
  } catch {}
  return null;
}
const normalize = value => value.toLowerCase().replace(/\s+/g, ' ').trim();
export function matchNewJob(previous, jobs, prompt) {
  const key = normalize(prompt).split(/\s+--[a-z]/)[0];
  if (!key) return null;
  const matches = jobs.filter(job => {
    if (previous.has(job.url) || !jobIdFromUrl(job.url)) return false;
    // Compare the full prompt line. A new card for "quiet garden in snow" cannot claim "quiet garden".
    return job.text.split(/\r?\n/).some(line => normalize(line).split(/\s+--[a-z]/)[0] === key) ||
      normalize(job.text).split(/\s+--[a-z]/)[0] === key;
  });
  return matches.length === 1 ? matches[0].url : null;
}

export async function downloadShots(jobUrl, fetchGrid, split, wait = sleep) {
  const id = jobIdFromUrl(jobUrl);
  if (!id) throw Error('请记录官网 jobs 任务的完整链接');
  const url = 'https://cdn.midjourney.com/' + id + '/grid_0.png';
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetchGrid(attempt === 0 ? url : url + '?t=' + Date.now(), { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (response.status === 404) { await response.body?.cancel(); await wait(5000); continue; }
    if (response.status !== 200) { await response.body?.cancel(); throw Error('官网图片下载返回 HTTP ' + response.status + '，可稍后在该批次重新取图'); }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) throw Error('官网四宫格超过 30 MiB');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const { width, height, mediaType } = imageInfo(bytes);
    if (mediaType !== 'image/png' || width % 2 || height % 2 || width * height > 32_000_000) throw Error('官网返回的图片无法按四宫格切分');
    return split(bytes, width / 2, height / 2);
  }
  throw Error('官网尚未提供四宫格，可稍后在该批次重新取图');
}

// Auto-submit is off unless the user explicitly accepted the Midjourney terms-of-service warning.
// The file only ever stores a boolean and the time it was accepted; anything unreadable means "off".
export class MjRelaySettings {
  constructor(file) { this.file = file; }
  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value?.autoSubmit === true && typeof value.acknowledgedAt === 'string') return { autoSubmit: true, acknowledgedAt: value.acknowledgedAt };
    } catch {}
    return { autoSubmit: false, acknowledgedAt: null };
  }
  setAutoSubmit(enabled) {
    const value = enabled === true ? { autoSubmit: true, acknowledgedAt: new Date().toISOString() } : { autoSubmit: false, acknowledgedAt: null };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameWithRetry(temporary, this.file);
    return value;
  }
}

export class MjRelay {
  constructor(store, browser, settings = null) { this.store = store; this.browser = browser; this.settings = settings; this.busy = false; }
  get autoSubmit() { return this.settings?.read().autoSubmit === true; }
  pendingFile(taskId, revision) {
    const task = this.store.get(taskId);
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > task.revisions.length) throw Error('任务版本无效');
    return path.join(this.store.root, 'mj-pending-' + task.taskId + '-' + revision + '.json');
  }
  // An unverified send blocks retries of the same revision so a lost response cannot cause a second paid job.
  pendingAttempt(taskId, revision) {
    const file = this.pendingFile(taskId, revision);
    if (!fs.existsSync(file)) return null;
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return { revision, attemptedAt: value.attemptedAt ?? null, autoSubmit: value.autoSubmit === true }; }
    catch { return { revision, attemptedAt: null, autoSubmit: false }; }
  }
  // Called only after the user checked the website: either nothing was generated, or the job was recorded manually.
  clearPending(taskId, revision) {
    if (this.busy) throw Error('MJ 任务正在转接，完成后再清除');
    const file = this.pendingFile(taskId, revision);
    if (!fs.existsSync(file)) return { cleared: false };
    fs.unlinkSync(file);
    return { cleared: true };
  }
  async collect(taskId, runId) {
    const run = this.store.get(taskId).runs.find(item => item.runId === runId);
    if (!run) throw Error('找不到对应的官网提交批次');
    const shots = await this.browser.download(run.websiteUrl);
    const uploads = shots.map((bytes, i) => ({
      sha256: saveImage(this.store.root, { ...imageInfo(bytes), data: bytes }).sha256, originalName: 'output_' + (i + 1) + '.png',
    }));
    return this.store.importStoredResults(taskId, run.revision, runId, uploads).length;
  }
  async generate(taskId, revision) {
    if (this.busy) throw Error('已有 MJ 任务正在转接，请等待完成');
    this.busy = true;
    try {
      const handoff = this.store.handoff(taskId, revision);
      const snapshot = this.store.get(taskId).revisions[revision - 1];
      const pending = this.pendingFile(taskId, revision);
      if (fs.existsSync(pending)) throw Error('此版本已有一次未核实的发送。请在官网核对：已生成就用“我已在官网提交”记录任务链接；确认没有生成可点“清除未核实记录”后重试。');
      const requestKey = randomUUID();
      const autoSubmit = this.autoSubmit;
      const jobUrl = await this.browser.submit(handoff.promptText, snapshot, () => {
        this.store.handoff(taskId, revision);
        fs.writeFileSync(pending, JSON.stringify({ requestKey, revision, autoSubmit, attemptedAt: new Date().toISOString() }), { flag: 'wx' });
      }, { autoSubmit });
      if (!jobIdFromUrl(jobUrl)) throw Error('官网任务链接无效');
      const run = this.store.recordSubmission(taskId, revision, requestKey, jobUrl, { allowConfirmedHistorical: true });
      fs.unlinkSync(pending);
      await this.collect(taskId, run.runId);
      return run.runId;
    } finally { this.busy = false; }
  }
}
