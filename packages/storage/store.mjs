import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireThat, WorkbenchError, validateInput, validateReady } from '../core/validation.mjs';
import { compileMj } from '../core/mj-handoff.mjs';
import { saveImage, verifyAsset, readImage, findStoredImage } from './assets.mjs';

const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const json = value => JSON.stringify(value, null, 2) + '\n';
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const renameWaiter = new Int32Array(new SharedArrayBuffer(4));
export function renameWithRetry(source, destination, rename = fs.renameSync) {
  for (let attempt = 0; ; attempt += 1) {
    try { rename(source, destination); return; }
    catch (error) {
      const transient = error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES';
      if (!transient || attempt >= 7) throw error;
      // Windows indexing and antivirus can briefly retain a just-written directory handle.
      Atomics.wait(renameWaiter, 0, 0, 20 * (attempt + 1));
    }
  }
}
function atomicWrite(file, text) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  renameWithRetry(temp, file);
}
function validateState(db) {
  requireThat(db?.version === 1 && Array.isArray(db.tasks), 'STORE_CORRUPTED', '任务库结构无效，请从备份恢复，不能自动重置');
  const taskIds = new Set();
  for (const task of db.tasks) {
    requireThat(idPattern.test(task.taskId) && !taskIds.has(task.taskId) && Array.isArray(task.revisions) && task.revisions.length === task.head && Array.isArray(task.runs) && Array.isArray(task.results), 'STORE_CORRUPTED', '任务索引损坏');
    taskIds.add(task.taskId);
    task.revisions.forEach((revision, i) => {
      validateInput(revision);
      requireThat(revision.taskId === task.taskId && revision.revision === i + 1, 'STORE_CORRUPTED', '输入版本链损坏');
    });
    const runIds = new Set(), keys = new Set(), resultIds = new Set();
    for (const run of task.runs) {
      requireThat(idPattern.test(run.runId) && idPattern.test(run.requestKey) && !runIds.has(run.runId) && !keys.has(run.requestKey) && task.revisions[run.revision - 1]?.confirmation && task.revisions[run.revision - 1]?.mode === 'mj_web', 'STORE_CORRUPTED', '提交批次索引损坏');
      runIds.add(run.runId); keys.add(run.requestKey);
    }
    for (const result of task.results) {
      requireThat(idPattern.test(result.resultId) && !resultIds.has(result.resultId) && task.runs.some(run => run.runId === result.runId && run.revision === result.revision) && typeof result.selected === 'boolean' && /^[a-f0-9]{64}$/.test(result.sha256), 'STORE_CORRUPTED', '结果关联损坏');
      resultIds.add(result.resultId);
    }
  }
  return db;
}

export class TaskStore {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true });
    this.root = fs.realpathSync(root);
    this.file = path.join(this.root, 'tasks.json');
    this.lock = path.join(this.root, 'write.lock');
  }
  read() {
    if (!fs.existsSync(this.file)) {
      requireThat(!fs.existsSync(path.join(this.root, 'tasks.previous.json')), 'STORE_CORRUPTED', '主任务库丢失但备份仍在，请显式恢复；不会自动创建空库');
      return { version: 1, tasks: [] };
    }
    try { return validateState(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch (error) { throw new WorkbenchError('STORE_CORRUPTED', `任务库无法读取，原文件已保留：${error.message}`); }
  }
  transaction(action) {
    let fd;
    try { fd = fs.openSync(this.lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new WorkbenchError('STORE_LOCKED', '另一写入正在进行或上次进程中断；确认进程已退出后，在工作台点“解除写锁”或运行 CLI recover-lock，不要删除任务库');
      throw error;
    }
    try {
      fs.writeFileSync(fd, json({ pid: process.pid, createdAt: now() })); fs.fsyncSync(fd);
      const db = this.read();
      const result = action(db);
      validateState(db);
      if (fs.existsSync(this.file)) atomicWrite(path.join(this.root, 'tasks.previous.json'), fs.readFileSync(this.file));
      atomicWrite(this.file, json(db));
      return clone(result);
    } finally { fs.closeSync(fd); fs.unlinkSync(this.lock); }
  }
  // Describes a leftover write.lock so the UI can offer recovery without the CLI.
  lockStatus() {
    let stat;
    try { stat = fs.statSync(this.lock); } catch (error) { if (error.code === 'ENOENT') return { locked: false }; throw error; }
    let lock = null;
    try { lock = JSON.parse(fs.readFileSync(this.lock, 'utf8')); } catch {}
    const pid = Number.isSafeInteger(lock?.pid) && lock.pid > 0 ? lock.pid : null;
    let ownerAlive = null;
    if (pid) { ownerAlive = true; try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') ownerAlive = false; } }
    const ageMs = Date.now() - stat.mtimeMs;
    // Writes are synchronous and take milliseconds. An unreadable lock older than a minute was cut off by a crash.
    const recoverable = pid ? ownerAlive === false : ageMs > 60000;
    return { locked: true, pid, createdAt: lock?.createdAt ?? null, ownerAlive, ageMs, recoverable };
  }
  recoverLock() {
    const status = this.lockStatus();
    if (!status.locked) return { recovered: false };
    requireThat(status.pid || status.recoverable, 'LOCK_INVALID', '锁文件无有效 PID 且刚刚创建，请一分钟后重试或人工检查');
    requireThat(status.recoverable, 'LOCK_OWNER_ALIVE', '锁的所属进程仍存在，不会抢占锁');
    this.read(); // Never erase a lock to hide database corruption.
    fs.unlinkSync(this.lock);
    return { recovered: true, previousPid: status.pid };
  }
  get(taskId, db = this.read()) {
    const task = db.tasks.find(x => x.taskId === taskId);
    requireThat(task, 'TASK_NOT_FOUND', '任务不存在'); return task;
  }
  revision(task, number, latest = false) {
    requireThat(Number.isSafeInteger(number) && number > 0 && (!latest || number === task.head), 'REVISION_CONFLICT', '版本已变化，请重新读取并确认');
    const snapshot = task.revisions[number - 1];
    requireThat(snapshot, 'REVISION_NOT_FOUND', '版本不存在'); return snapshot;
  }
  importAssets(input, assetRoot) {
    validateInput(input);
    input.references = input.references.map(ref => ({ ...ref, ...saveImage(this.root, verifyAsset(assetRoot, ref)) }));
    return input;
  }
  create(input, assetRoot = this.root) {
    const snapshot = clone(input); validateInput(snapshot);
    snapshot.revision = 1; snapshot.confirmation = null; snapshot.createdAt = now();
    return this.transaction(db => {
      requireThat(!db.tasks.some(x => x.taskId === snapshot.taskId), 'TASK_EXISTS', '任务 ID 已存在；请用 revise 或生成新任务 ID');
      this.importAssets(snapshot, assetRoot);
      const task = { taskId: snapshot.taskId, head: 1, revisions: [snapshot], runs: [], results: [] };
      db.tasks.push(task); return task;
    });
  }
  revise(taskId, expectedRevision, input, assetRoot = this.root) {
    const snapshot = clone(input); validateInput(snapshot);
    requireThat(snapshot.taskId === taskId, 'TASK_ID_MISMATCH', '修改内容属于其他任务');
    requireThat(snapshot.revision === expectedRevision, 'REVISION_CONFLICT', '编辑文件不是期望的原版本，请先重新导出最新快照');
    return this.transaction(db => {
      const task = this.get(taskId, db); this.revision(task, expectedRevision, true);
      snapshot.revision = task.head + 1; snapshot.confirmation = null; snapshot.createdAt = now();
      this.importAssets(snapshot, assetRoot);
      task.revisions.push(snapshot); task.head = snapshot.revision; return task;
    });
  }
  confirm(taskId, revision, reviews) {
    requireThat(reviews?.promptReviewed === true && reviews?.settingsReviewed === true && reviews?.referencesReviewed === true, 'REVIEW_REQUIRED', '必须分别确认提示词、设置和参考图');
    return this.transaction(db => {
      const task = this.get(taskId, db), snapshot = this.revision(task, revision, true);
      validateReady(snapshot);
      if (snapshot.mode === 'mj_web') compileMj(snapshot);
      snapshot.references.forEach(ref => verifyAsset(this.root, ref));
      snapshot.confirmation ??= { revision, confirmedAt: now(), promptReviewed: true, settingsReviewed: true, referencesReviewed: true };
      return snapshot;
    });
  }
  handoff(taskId, revision) {
    const task = this.get(taskId), snapshot = this.revision(task, revision, true);
    requireThat(snapshot.confirmation, 'CONFIRMATION_REQUIRED', '请先人工确认该版本');
    snapshot.references.forEach(ref => verifyAsset(this.root, ref));
    return { taskId, revision, ...compileMj(snapshot), state: 'ready_for_web' };
  }
  recordSubmission(taskId, revision, requestKey, websiteUrl = null, { allowConfirmedHistorical = false } = {}) {
    requireThat(idPattern.test(requestKey ?? ''), 'REQUEST_KEY_REQUIRED', '请提供唯一 request-id；重复使用同一 ID 不会产生重复批次');
    if (websiteUrl !== null) {
      let url; try { url = new URL(websiteUrl); } catch { throw new WorkbenchError('INVALID_URL', '官网任务链接无效'); }
      requireThat(url.protocol === 'https:' && ['www.midjourney.com', 'midjourney.com'].includes(url.hostname) && !url.username && !url.password && !url.port, 'INVALID_URL', '仅可记录 HTTPS Midjourney 官网链接');
    }
    return this.transaction(db => {
      const task = this.get(taskId, db);
      const existing = task.runs.find(run => run.requestKey === requestKey);
      if (existing) {
        requireThat(existing.revision === revision && existing.websiteUrl === websiteUrl, 'REQUEST_KEY_CONFLICT', '该 request-id 已用于另一提交内容'); return existing;
      }
      const snapshot = this.revision(task, revision, !allowConfirmedHistorical);
      requireThat(snapshot.confirmation, 'CONFIRMATION_REQUIRED', '只能记录已确认版本的官网提交');
      compileMj(snapshot); snapshot.references.forEach(ref => verifyAsset(this.root, ref));
      const run = { runId: randomUUID(), revision, requestKey, submittedAt: now(), websiteUrl, state: 'submitted_by_user' };
      task.runs.push(run); return run;
    });
  }
  importResults(taskId, revision, runId, filenames) {
    requireThat(Array.isArray(filenames) && filenames.length > 0 && filenames.length <= 32, 'RESULT_FILES_REQUIRED', '每批请选择 1–32 张结果');
    return this.transaction(db => {
      const task = this.get(taskId, db);
      const run = task.runs.find(run => run.runId === runId && run.revision === revision);
      requireThat(run, 'RUN_MISMATCH', '所选任务/版本/批次不匹配；不会自动猜测归属');
      // Validate the whole batch before adding result records.
      requireThat(filenames.reduce((sum, filename) => sum + fs.statSync(filename).size, 0) <= 128 * 1024 * 1024, 'ASSET_TOTAL_SIZE', '每批结果总量不能超过 128 MiB');
      const images = filenames.map(filename => ({ filename, image: readImage(filename) }));
      const imported = images.map(({ filename, image }) => {
        const existing = task.results.find(result => result.runId === runId && result.sha256 === image.sha256);
        if (existing) { verifyAsset(this.root, existing); return existing; }
        const result = { resultId: randomUUID(), runId, revision, originalName: path.basename(filename), importedAt: now(), selected: false, ...saveImage(this.root, image) };
        task.results.push(result); return result;
      });
      run.state = 'results_imported'; return imported;
    });
  }
  importStoredResults(taskId, revision, runId, uploads) {
    requireThat(Array.isArray(uploads) && uploads.length > 0 && uploads.length <= 32, 'RESULT_FILES_REQUIRED', '每批请选择 1–32 张结果');
    const images = uploads.map(upload => {
      requireThat(upload && typeof upload.originalName === 'string' && upload.originalName.length > 0 && upload.originalName.length <= 255 && !/[\\/\0]/.test(upload.originalName), 'INVALID_FILENAME', '结果文件名无效');
      return { upload, image: findStoredImage(this.root, upload.sha256) };
    });
    requireThat(images.reduce((sum, item) => sum + item.image.bytes, 0) <= 128 * 1024 * 1024, 'ASSET_TOTAL_SIZE', '每批结果总量不能超过 128 MiB');
    return this.transaction(db => {
      const task = this.get(taskId, db);
      const run = task.runs.find(run => run.runId === runId && run.revision === revision);
      requireThat(run, 'RUN_MISMATCH', '所选任务/版本/批次不匹配；不会自动猜测归属');
      const imported = images.map(({ upload, image }) => {
        const existing = task.results.find(result => result.runId === runId && result.sha256 === image.sha256);
        if (existing) { verifyAsset(this.root, existing); return existing; }
        const result = { resultId: randomUUID(), runId, revision, originalName: upload.originalName, importedAt: now(), selected: false, path: image.path, mediaType: image.mediaType, width: image.width, height: image.height, bytes: image.bytes, sha256: image.sha256 };
        task.results.push(result); return result;
      });
      run.state = 'results_imported'; return imported;
    });
  }
  select(taskId, resultId, selected) {
    requireThat(typeof selected === 'boolean', 'INVALID_SELECTION', 'selected 必须是布尔值');
    return this.transaction(db => {
      const result = this.get(taskId, db).results.find(x => x.resultId === resultId);
      requireThat(result, 'RESULT_NOT_FOUND', '该任务中没有此结果'); result.selected = selected; return result;
    });
  }
  export(taskId, revision, destination, { promptOnly = false, runId = null, handoff = false } = {}) {
    const task = this.get(taskId), snapshot = this.revision(task, revision);
    const prepared = handoff ? this.handoff(taskId, revision) : null;
    const run = runId === null ? null : task.runs.find(x => x.runId === runId && x.revision === revision);
    requireThat(runId === null || run, 'RUN_MISMATCH', '导出批次不属于这个输入版本');
    requireThat(!(promptOnly && (runId || handoff)), 'EXPORT_CONFLICT', '仅提示词导出不能同时包含结果或官网交接');
    const selected = run ? task.results.filter(x => x.runId === runId && x.selected) : [];
    if (run) requireThat(selected.length > 0, 'NO_SELECTION', '请先选择该批次要导出的结果');
    const output = path.resolve(destination);
    requireThat(!fs.existsSync(output), 'OUTPUT_EXISTS', '导出目录已存在；请选择新目录，避免覆盖');
    const material = promptOnly ? [] : [...snapshot.references, ...selected];
    requireThat(material.reduce((sum, ref) => sum + ref.bytes, 0) <= 128 * 1024 * 1024, 'ASSET_TOTAL_SIZE', '导出总素材量不能超过 128 MiB；请减少所选结果');
    const images = material.map(ref => ({ ref, image: verifyAsset(this.root, ref) }));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(output), '.workbench-export-'));
    // An interrupted export remains a clearly named staging directory, never a falsely complete destination.
    for (const { ref, image } of images) {
      const target = path.join(staging, ref.path); fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.writeFileSync(target, image.data, { flag: 'wx' });
    }
    const text = prepared?.promptText ?? snapshot.prompt.text;
    fs.writeFileSync(path.join(staging, 'prompt.txt'), text + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(staging, 'prompt.md'), `# 提示词\n\n${text}\n\n## 需求及来源说明\n\n${snapshot.prompt.intent}\n`, { flag: 'wx' });
    if (promptOnly) {
      fs.writeFileSync(path.join(staging, 'prompt-export.json'), json({ kind: 'prompt-only', taskId, revision, mode: snapshot.mode, prompt: snapshot.prompt, settings: snapshot.settings, referencesIncluded: false }), { flag: 'wx' });
    } else {
      fs.writeFileSync(path.join(staging, 'job.json'), json(snapshot), { flag: 'wx' });
      if (run) fs.writeFileSync(path.join(staging, 'results.json'), json({ taskId, revision, run, results: selected }), { flag: 'wx' });
      if (prepared) fs.writeFileSync(path.join(staging, 'website-checklist.txt'), [prepared.url, ...prepared.websiteChecklist.map(x => `[ ] ${x}`)].join('\n') + '\n', { flag: 'wx' });
    }
    renameWithRetry(staging, output);
    return { directory: output, taskId, revision, resultCount: selected.length, promptOnly };
  }
  submitBanana() {
    throw new WorkbenchError('BANANA_NOT_CONFIGURED', 'Banana 图像 API 尚未实现：需先确认服务商、模型 ID 与接口协议。可保存草稿或导出提示词。');
  }
}

export function taskStatus(task) {
  const current = task.revisions[task.head - 1];
  if (!current.confirmation) return 'draft';
  if (current.mode === 'banana_api') return 'confirmed_api_unavailable';
  const runs = task.runs.filter(run => run.revision === task.head);
  if (runs.some(run => run.state === 'results_imported')) return 'results_imported';
  return runs.length ? 'submitted_by_user' : 'ready_for_web';
}
