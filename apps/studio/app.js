import { RevisionScopedCache } from './revision-state.js';

const $ = selector => document.querySelector(selector);
const state = {
  meta: null,
  tasks: [],
  selectedTaskId: null,
  selected: null,
  mode: 'mj_web',
  editing: null,
  assets: [],
  busy: 0,
  handoffs: new RevisionScopedCache(),
  exports: new RevisionScopedCache(),
  pendingSubmissionKeys: new Map(),
  mjSettings: { autoSubmit: false },
};

const labels = {
  draft: '待确认', ready_for_web: '可交接官网', submitted_by_user: '用户已提交', results_imported: '结果已导入',
  confirmed_api_unavailable: '已确认 · API 未配置', mj_web: 'MJ 官网', banana_api: 'Banana API', create: '创作', edit: '编辑 / 合成',
};
const roleLabels = {
  image_prompt: 'Image Prompt', style_reference: 'Style Reference', edit_reference: 'Edit Model 参考',
  base: '编辑底图', mask: '蒙版', character_reference: '旧 Character / Omni',
};
const refs = {
  form: $('#taskForm'), taskList: $('#taskList'), taskCount: $('#taskCount'), detail: $('#taskDetail'),
  formMessage: $('#formMessage'), toast: $('#toast'), assetList: $('#assetList'), fileInput: $('#referenceFiles'),
  drop: $('#referenceDrop'), save: $('#saveTaskButton'), editorTitle: $('#editorTitle'), editorSubtitle: $('#editorSubtitle'),
  editHint: $('#editRevisionHint'), connection: $('#connectionState'), mjSettings: $('#mjSettings'), bananaSettings: $('#bananaSettings'),
};

function setBusy(on) {
  const previous = state.busy;
  state.busy += on ? 1 : -1;
  state.busy = Math.max(0, state.busy);
  document.body.toggleAttribute('aria-busy', state.busy > 0);
  if (previous === 0 && state.busy > 0) document.querySelectorAll('[data-mutation], #saveTaskButton').forEach(element => { element.dataset.busyRestore = String(element.disabled); element.disabled = true; });
  if (previous > 0 && state.busy === 0) document.querySelectorAll('[data-busy-restore]').forEach(element => { element.disabled = element.dataset.busyRestore === 'true'; delete element.dataset.busyRestore; });
}
async function runAction(action) {
  setBusy(true); clearFormError();
  try { return await action(); }
  catch (error) { showToast(error.message, true); if (error.code === 'STORE_LOCKED') checkStoreLock().catch(() => {}); throw error; }
  finally { setBusy(false); }
}
function showToast(message, isError = false) {
  refs.toast.textContent = message;
  refs.toast.style.borderColor = isError ? '#75434a' : '';
  refs.toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.remove('is-visible'), 4200);
}
function showFormError(message) {
  refs.formMessage.textContent = message; refs.formMessage.hidden = false; refs.formMessage.scrollIntoView({ block: 'nearest' });
}
function clearFormError() { refs.formMessage.hidden = true; refs.formMessage.textContent = ''; }
function requestKey() { return crypto.randomUUID(); }
async function api(path, { method = 'GET', body, key } = {}) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) { options.body = JSON.stringify(body); options.headers['Content-Type'] = 'application/json'; }
  if (!['GET', 'HEAD'].includes(method)) {
    options.headers['X-Workbench-CSRF'] = state.meta.csrfToken;
    options.headers['Idempotency-Key'] = key ?? requestKey();
  }
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({ error: { message: `本地服务返回了无法读取的响应（${response.status}）` } }));
  if (!response.ok) { const error = new Error(data.error?.message ?? `请求失败（${response.status}）`); error.code = data.error?.code; throw error; }
  return data;
}
async function upload(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`${file.name} 不是受支持的 PNG、JPEG 或 WebP`);
  if (!file.size || file.size > state.meta.limits.imageBytes) throw new Error(`${file.name} 必须小于 30 MiB`);
  let decoded;
  try { decoded = await createImageBitmap(file); }
  catch { throw new Error(`${file.name} 无法完整解码，请重新导出为有效的 PNG、JPEG 或 WebP`); }
  const decodedSize = { width: decoded.width, height: decoded.height }; decoded.close();
  const response = await fetch('/api/uploads', {
    method: 'POST', body: file,
    headers: { Accept: 'application/json', 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name), 'X-Workbench-CSRF': state.meta.csrfToken, 'Idempotency-Key': requestKey() },
  });
  const data = await response.json().catch(() => ({ error: { message: `上传响应无法读取（${response.status}）` } }));
  if (!response.ok) throw new Error(data.error?.message ?? `上传失败（${response.status}）`);
  if (data.upload.width !== decodedSize.width || data.upload.height !== decodedSize.height) throw new Error(`${file.name} 的浏览器解码尺寸与服务端文件头不一致，已停止使用`);
  return data.upload;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, handler, mutation = false) {
  const node = el('button', `button ${className}`, text); node.type = 'button';
  if (mutation) node.dataset.mutation = '';
  node.addEventListener('click', event => { Promise.resolve(handler(event)).catch(() => {}); }); return node;
}
function formatDate(value) {
  try { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
  catch { return value; }
}
function sizeLabel(bytes) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function nullableNumber(id) { const value = $(id).value.trim(); return value === '' ? null : Number(value); }
function nullableText(id) { const value = $(id).value.trim(); return value || null; }

function roleOptions() {
  return state.mode === 'mj_web'
    ? ['image_prompt', 'style_reference', 'edit_reference', 'character_reference']
    : ['base', 'edit_reference', 'style_reference', 'image_prompt', 'mask'];
}
function defaultRole() {
  if (state.mode === 'banana_api') return $('#operationInput').value === 'edit' ? 'base' : 'image_prompt';
  return $('#operationInput').value === 'edit' ? 'edit_reference' : 'image_prompt';
}
function renderAssets() {
  refs.assetList.replaceChildren();
  if (!state.assets.length) { refs.assetList.append(el('p', 'empty-inline', '尚未添加素材。')); updateCapabilities(); return; }
  for (const asset of state.assets) {
    const row = el('div', 'asset-row');
    const image = el('img', 'asset-thumb'); image.src = `/api/assets/${asset.sha256}`; image.alt = asset.originalName || asset.assetId;
    image.addEventListener('error', () => { image.alt = '图片无法显示'; });
    const body = el('div', 'asset-body');
    body.append(el('div', 'asset-name', asset.originalName || asset.assetId), el('div', 'asset-meta', `${asset.width} × ${asset.height} · ${sizeLabel(asset.bytes)}`));
    const controls = el('div', 'asset-controls');
    const select = document.createElement('select'); select.setAttribute('aria-label', `${asset.originalName || asset.assetId} 的素材用途`);
    for (const role of roleOptions()) { const option = document.createElement('option'); option.value = role; option.textContent = roleLabels[role]; option.selected = role === asset.role; select.append(option); }
    if (!roleOptions().includes(asset.role)) { const option = document.createElement('option'); option.value = asset.role; option.textContent = `${roleLabels[asset.role] || asset.role}（当前模式不推荐）`; option.selected = true; select.append(option); }
    select.addEventListener('change', () => { asset.role = select.value; updateCapabilities(); });
    const analysis = el('label', 'checkbox'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = asset.analysisOnly;
    checkbox.addEventListener('change', () => { asset.analysisOnly = checkbox.checked; updateCapabilities(); });
    analysis.append(checkbox, document.createTextNode('仅分析'));
    controls.append(select, analysis); body.append(controls);
    const remove = el('button', 'remove-button', '移除'); remove.type = 'button'; remove.setAttribute('aria-label', `移除 ${asset.originalName || asset.assetId}`);
    remove.addEventListener('click', () => { state.assets = state.assets.filter(item => item !== asset); renderAssets(); });
    row.append(image, body, remove); refs.assetList.append(row);
  }
  updateCapabilities();
}
async function addReferenceFiles(fileList) {
  const files = [...fileList]; if (!files.length) return;
  await runAction(async () => {
    for (const file of files) {
      const saved = await upload(file);
      state.assets.push({ ...saved, assetId: `asset_${crypto.randomUUID().replaceAll('-', '')}`, source: 'upload', role: defaultRole(), analysisOnly: false });
      renderAssets();
    }
    showToast(`已校验并加入 ${files.length} 张素材`);
  }).catch(error => showFormError(error.message));
  refs.fileInput.value = '';
}
function updateCapabilities() {
  if (!state.meta || state.mode !== 'mj_web') return;
  const version = $('#modelVersionInput').value.trim();
  const capability = state.meta.capabilities.versions[version];
  const issues = [];
  const production = state.assets.filter(asset => !asset.analysisOnly);
  const editCount = production.filter(asset => asset.role === 'edit_reference').length;
  if (!version) issues.push('模型未指定：交接时必须在官网选择并复核。');
  else if (!capability) issues.push(`“${version}”不在本地能力表中：只保留设置，必须在官网复核。`);
  else {
    if ($('#speedInput').value === 'turbo' && !capability.turbo) issues.push(`${version} 当前兼容表不支持 Turbo。`);
    if ($('#resolutionInput').value === 'hd' && !capability.hd) issues.push(`${version} 当前兼容表不支持 HD。`);
    if ($('#operationInput').value === 'edit' && (!capability.editModel || editCount === 0)) issues.push(`编辑任务需要 8.1/8.2 以及至少一张 Edit Model 参考图。`);
    if (editCount > capability.editReferences) issues.push(`${version} 最多 ${capability.editReferences} 张 Edit Model 参考图。`);
    if (production.some(asset => !capability.roles.includes(asset.role))) issues.push('有生产素材的角色与所选版本不兼容。');
  }
  if (production.some(asset => asset.bytes > state.meta.limits.mjUploadBytes)) issues.push('有生产素材超过官网当前 10 MiB 单图限制。');
  refs.capability = refs.capability || $('#capabilityNote'); refs.capability.replaceChildren(); refs.capability.classList.toggle('is-warning', issues.length > 0);
  refs.capability.append(document.createTextNode(issues.length ? issues.join(' ') : `${version} 的当前结构化检查未发现冲突。`));
  const links = el('span', 'source-links');
  for (const source of state.meta.capabilities.sources) { const link = el('a', '', source.label); link.href = source.url; link.target = '_blank'; link.rel = 'noreferrer'; links.append(link); }
  refs.capability.append(document.createElement('br'), document.createTextNode(`能力表更新：${state.meta.capabilities.updatedAt}。`), links);
}

function setMode(mode, reset = true) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(node => { const active = node.dataset.mode === mode; node.classList.toggle('is-active', active); node.setAttribute('aria-pressed', String(active)); });
  refs.mjSettings.hidden = mode !== 'mj_web'; refs.bananaSettings.hidden = mode !== 'banana_api';
  if (reset) resetEditor(mode);
  refs.editorTitle.textContent = state.editing ? `编辑任务 · 版本 ${state.editing.revision}` : mode === 'mj_web' ? '新建 MJ 官网任务' : '新建 Banana API 草稿';
  refs.editorSubtitle.textContent = mode === 'mj_web' ? '准备内容，人工确认后再去官网提交。' : '先保存提示词与素材；图像 API 尚未配置。';
  renderAssets();
}
function resetEditor(mode = state.mode) {
  refs.form.reset(); state.editing = null; state.assets = [];
  refs.save.textContent = '创建任务'; refs.editHint.textContent = '保存后进入待确认状态。'; clearFormError();
  $('#operationInput').value = mode === 'banana_api' ? 'edit' : 'create';
  refs.editorTitle.textContent = mode === 'mj_web' ? '新建 MJ 官网任务' : '新建 Banana API 草稿';
  renderAssets();
}
function loadEditor(taskResponse) {
  const task = taskResponse.task, snapshot = structuredClone(task.revisions[task.head - 1]);
  state.editing = { taskId: task.taskId, revision: task.head, snapshot };
  state.mode = snapshot.mode; setMode(snapshot.mode, false);
  $('#intentInput').value = snapshot.prompt.intent; $('#promptInput').value = snapshot.prompt.text; $('#operationInput').value = snapshot.operation;
  if (snapshot.mode === 'mj_web') {
    $('#modelVersionInput').value = snapshot.settings.modelVersion ?? ''; $('#aspectRatioInput').value = snapshot.settings.aspectRatio ?? '';
    $('#rawInput').value = snapshot.settings.raw === null ? '' : String(snapshot.settings.raw);
    for (const key of ['stylize', 'chaos', 'weird', 'seed']) $(`#${key}Input`).value = snapshot.settings[key] ?? '';
    $('#speedInput').value = snapshot.settings.speed ?? ''; $('#resolutionInput').value = snapshot.settings.resolution ?? '';
  } else {
    $('#providerInput').value = snapshot.settings.providerId ?? ''; $('#bananaModelInput').value = snapshot.settings.modelId ?? '';
    $('#bananaAspectInput').value = snapshot.settings.aspectRatio ?? ''; $('#bananaResolutionInput').value = snapshot.settings.resolution ?? '';
  }
  state.assets = snapshot.references.map(reference => ({ ...reference, originalName: reference.assetId })); renderAssets();
  refs.editorTitle.textContent = `编辑任务 · 版本 ${task.head}`; refs.save.textContent = '保存为新版本';
  refs.editHint.textContent = '保存会生成新版本，并清除旧确认。';
  if (matchMedia('(max-width: 800px)').matches) switchMobilePane('editor');
  $('#intentInput').focus();
}
function collectInput() {
  if (!refs.form.reportValidity()) throw new Error('请先修正表单中标出的字段');
  const taskId = state.editing?.taskId ?? crypto.randomUUID();
  const previous = state.editing?.snapshot;
  const input = {
    schemaVersion: '0.1.0', taskId, revision: state.editing?.revision ?? 1, createdAt: new Date().toISOString(),
    mode: state.mode, operation: $('#operationInput').value,
    prompt: { ...previous?.prompt, intent: $('#intentInput').value, text: $('#promptInput').value, source: previous?.prompt.source ?? 'manual', workflowId: previous?.prompt.workflowId ?? null },
    references: state.assets.map(({ originalName, ...asset }) => asset), confirmation: null, photoshopContext: previous?.photoshopContext ?? null,
    settings: state.mode === 'mj_web' ? {
      modelVersion: nullableText('#modelVersionInput'), aspectRatio: nullableText('#aspectRatioInput'), raw: $('#rawInput').value === '' ? null : $('#rawInput').value === 'true',
      stylize: nullableNumber('#stylizeInput'), chaos: nullableNumber('#chaosInput'), weird: nullableNumber('#weirdInput'), seed: nullableNumber('#seedInput'),
      speed: nullableText('#speedInput'), resolution: nullableText('#resolutionInput'), extraParameters: '', websiteChecklist: previous?.mode === 'mj_web' ? previous.settings.websiteChecklist : [],
    } : { providerId: nullableText('#providerInput'), modelId: nullableText('#bananaModelInput'), aspectRatio: nullableText('#bananaAspectInput'), resolution: nullableText('#bananaResolutionInput') },
  };
  return input;
}

async function saveTask(event) {
  event.preventDefault();
  try {
    const input = collectInput();
    const wasEditing = Boolean(state.editing);
    await runAction(async () => {
      if (state.editing) await api(`/api/tasks/${encodeURIComponent(input.taskId)}`, { method: 'PUT', body: { expectedRevision: state.editing.revision, input } });
      else await api('/api/tasks', { method: 'POST', body: { input } });
      state.selectedTaskId = input.taskId; resetEditor(state.mode); await refreshTasks(true); showToast(wasEditing ? '已保存新版本' : '任务已创建');
    });
  } catch (error) { showFormError(error.message); }
}

async function refreshTasks(keepSelection = true) {
  const data = await api('/api/tasks'); state.tasks = data.tasks;
  if (!keepSelection || !state.tasks.some(task => task.taskId === state.selectedTaskId)) state.selectedTaskId = state.tasks[0]?.taskId ?? null;
  renderTaskList();
  if (state.selectedTaskId) await selectTask(state.selectedTaskId, false);
  else renderWelcome();
}
function renderTaskList() {
  refs.taskList.replaceChildren(); refs.taskCount.textContent = String(state.tasks.length);
  if (!state.tasks.length) { refs.taskList.append(el('p', 'empty-state', '还没有任务。先在左侧创建一个草稿。')); return; }
  for (const task of state.tasks) {
    const item = el('button', `task-item${task.taskId === state.selectedTaskId ? ' is-selected' : ''}`); item.type = 'button';
    if (task.taskId === state.selectedTaskId) item.setAttribute('aria-current', 'true');
    item.append(el('span', 'status-chip ' + task.status, labels[task.status] ?? task.status), el('span', 'task-prompt', task.prompt || '未填写提示词'));
    const meta = el('span', 'task-meta'); meta.append(document.createTextNode(`${labels[task.mode]} · r${task.revision} · ${formatDate(task.updatedAt)}`)); item.append(meta);
    item.addEventListener('click', () => selectTask(task.taskId)); refs.taskList.append(item);
  }
}
async function selectTask(taskId, announce = true) {
  state.selectedTaskId = taskId; renderTaskList();
  try { state.selected = await api(`/api/tasks/${encodeURIComponent(taskId)}`); renderDetail(); if (announce && matchMedia('(max-width: 800px)').matches) switchMobilePane('workspace'); }
  catch (error) { refs.detail.replaceChildren(el('div', 'inline-notice warning', error.message)); }
}
function renderWelcome() { refs.detail.replaceChildren(el('div', 'welcome-state')); refs.detail.firstChild.append(el('h2', '', '从左侧开始'), el('p', '', '填写提示词和设置，建立一个可追溯的任务。')); }

function addKeyValues(parent, entries) {
  const list = el('dl', 'key-values');
  for (const [key, value] of entries) { list.append(el('dt', '', key), el('dd', '', String(value ?? '未指定'))); }
  parent.append(list);
}
function renderDetail() {
  const { task, status } = state.selected; const snapshot = task.revisions[task.head - 1];
  refs.detail.replaceChildren();
  const heading = el('div', 'detail-heading'); const title = el('div'); title.append(el('span', `status-chip ${status}`, labels[status] ?? status), el('h2', '', snapshot.prompt.text || '未填写提示词'), el('p', '', `${labels[snapshot.mode]} · ${labels[snapshot.operation]} · 版本 ${task.head} · ${task.taskId}`));
  const headingActions = el('div', 'detail-actions');
  headingActions.append(button('载入左侧编辑', 'secondary compact', () => loadEditor(state.selected)), button('导出提示词', 'secondary compact', exportPrompt, true), button('导出任务包', 'secondary compact', exportPackage, true));
  headingActions.append(button('导出给提示词助手', 'secondary compact', () => runAction(async () => {
    const context = await api(`/api/tasks/${task.taskId}/wizard-context?revision=${snapshot.revision}`);
    downloadJson(`${task.taskId}-r${snapshot.revision}-context.json`, context);
    showToast('上下文已下载，请在提示词助手中导入');
  }), true));
  heading.append(title, headingActions); refs.detail.append(heading);
  const lastExport = state.exports.get(task.taskId, task.head);
  if (lastExport) {
    const notice = el('div', 'inline-notice success'); notice.append(document.createTextNode(`最近导出：${lastExport}`));
    notice.append(button('复制路径', 'secondary compact', () => copyText(lastExport, '导出路径已复制'))); refs.detail.append(notice);
  }

  const grid = el('div', 'detail-grid'), main = el('div'), side = el('aside');
  const promptSection = el('section', 'detail-section'); promptSection.append(el('h3', '', '最终提示词'), el('p', 'prompt-display', snapshot.prompt.text || '—'));
  if (snapshot.prompt.intent) promptSection.append(el('h3', '', '创作需求'), el('p', 'prompt-display', snapshot.prompt.intent)); main.append(promptSection);
  if (snapshot.prompt.exchange) {
    const source = snapshot.prompt.exchange, section = el('details', 'detail-section');
    section.append(el('summary', '', `提示词来源 · ${source.workflowId}`));
    section.append(el('h3', '', '分析过程'), el('p', 'prompt-display', source.context.analysis || '未提供'));
    section.append(el('h3', '', '需求与方向'), el('pre', 'prompt-display', JSON.stringify(source.context, null, 2)));
    section.append(el('h3', '', '原始产物'), el('p', 'prompt-display', source.artifact.prompt));
    section.append(el('p', '', source.selectedParameterIndex === null ? '参数方案未应用' : `已选择参数方案 ${source.selectedParameterIndex + 1}：${source.artifact.params[source.selectedParameterIndex]}`));
    main.append(section);
  }
  if (snapshot.mode === 'mj_web' && snapshot.settings.websiteChecklist.length) {
    const checklist = el('section', 'detail-section'); checklist.append(el('h3', '', '官网待核对项'));
    for (const item of snapshot.settings.websiteChecklist) checklist.append(el('p', 'prompt-display', item));
    main.append(checklist);
  }

  const settings = el('section', 'detail-section'); settings.append(el('h3', '', '设置快照'));
  if (snapshot.mode === 'mj_web') addKeyValues(settings, [['模型', snapshot.settings.modelVersion], ['比例', snapshot.settings.aspectRatio], ['Raw', snapshot.settings.raw === null ? '未指定' : snapshot.settings.raw ? '开启' : '关闭'], ['Stylize', snapshot.settings.stylize], ['Chaos', snapshot.settings.chaos], ['Weird', snapshot.settings.weird], ['Seed', snapshot.settings.seed], ['速度', snapshot.settings.speed], ['分辨率', snapshot.settings.resolution]]);
  else addKeyValues(settings, [['服务商', snapshot.settings.providerId], ['模型', snapshot.settings.modelId], ['比例', snapshot.settings.aspectRatio], ['分辨率', snapshot.settings.resolution]]);
  side.append(settings);
  const psSection = el('section', 'detail-section'); psSection.append(el('h3', '', 'Photoshop 回传'));
  if (snapshot.photoshopContext) {
    const ps = snapshot.photoshopContext;
    addKeyValues(psSection, [['目标文档', ps.documentName], ['文档 ID', ps.documentId], ['画布', `${ps.canvasWidth} × ${ps.canvasHeight}`], ['读取范围', ps.captureScope === 'selection' ? '选区' : '完整画布'], ['真实蒙版', ps.maskAssetId ? '已保存' : '无']]);
  } else psSection.append(el('p', 'empty-inline', '此任务没有 Photoshop 来源；结果仍可作为新文档打开。'));
  const psStatus = el('p', 'inline-notice', '正在检查 UXP 面板…'); psSection.append(psStatus); side.append(psSection);
  const selectedTaskId = task.taskId;
  api('/api/photoshop/status').then(status => {
    if (state.selectedTaskId !== selectedTaskId) return;
    psStatus.textContent = status.connected && status.capabilities?.includes('place') ? 'UXP 面板已连接，可安全回传。' : 'UXP 面板未连接；COM 通道只读。';
    psStatus.className = `inline-notice ${status.connected && status.capabilities?.includes('place') ? 'success' : 'warning'}`;
  }).catch(() => { psStatus.textContent = '无法读取 Photoshop 连接状态。'; psStatus.className = 'inline-notice warning'; });

  const assets = el('section', 'detail-section'); assets.append(el('h3', '', `素材 · ${snapshot.references.length} 张`));
  if (!snapshot.references.length) assets.append(el('p', 'empty-inline', '此版本没有素材。'));
  else { const assetGrid = el('div', 'reference-grid'); for (const reference of snapshot.references) {
    const figure = el('figure', 'reference-card'), image = el('img'); image.src = `/api/assets/${reference.sha256}`; image.alt = roleLabels[reference.role] ?? reference.role; image.loading = 'lazy';
    image.addEventListener('error', () => { image.alt = '素材损坏或缺失'; });
    figure.append(image, el('figcaption', '', `${roleLabels[reference.role] ?? reference.role}${reference.analysisOnly ? ' · 仅分析' : ''}\n${reference.width} × ${reference.height}`)); assetGrid.append(figure);
  } assets.append(assetGrid); } main.append(assets);

  if (!snapshot.confirmation) main.append(renderConfirmation(task, snapshot));
  else if (snapshot.mode === 'mj_web') main.append(renderWebsiteActions(task, snapshot));
  else { const section = el('section', 'detail-section'); section.append(el('h3', '', 'Banana API'), el('p', 'inline-notice warning', '草稿已确认，但图像服务商、模型与协议尚未配置。可继续导出提示词；不会发起请求。')); main.append(section); }
  if (task.runs.length) main.append(renderRuns(task, snapshot));
  grid.append(main, side); refs.detail.append(grid);
}
function renderConfirmation(task, snapshot) {
  const section = el('section', 'detail-section'); section.append(el('h3', '', '提交前人工确认'), el('p', 'inline-notice', '确认固定当前版本。之后修改提示词、设置或素材，会生成新版本并重新确认。'));
  const list = el('div', 'review-list'), checks = [];
  for (const text of ['提示词与需求已核对', '模型参数与官网设置已核对', '参考图用途和“仅分析”标记已核对']) {
    const label = el('label', 'checkbox'), input = document.createElement('input'); input.type = 'checkbox'; checks.push(input); label.append(input, document.createTextNode(text)); list.append(label);
  }
  const confirm = button('确认当前版本', 'primary', async () => {
    if (!checks.every(input => input.checked)) return showToast('请完成三项独立确认', true);
    await runAction(async () => { await api(`/api/tasks/${task.taskId}/confirm`, { method: 'POST', body: { revision: snapshot.revision, reviews: { promptReviewed: true, settingsReviewed: true, referencesReviewed: true } } }); await refreshTasks(true); showToast('当前版本已确认'); });
  }, true);
  section.append(list, confirm); return section;
}
function renderWebsiteActions(task, snapshot) {
  const section = el('section', 'detail-section'); section.append(el('h3', '', 'MJ 官网协作'));
  const actions = el('div', 'action-row');
  actions.append(button('复制并准备官网', 'primary', () => prepareHandoff(task, snapshot), true), button('打开 MJ 官网', 'secondary', () => window.open(state.meta.officialCreateUrl, '_blank', 'noopener,noreferrer')));
  if (window.pwWorkbench?.generateMj) {
    const autoSubmit = state.mjSettings.autoSubmit === true;
    const manual = !autoSubmit || snapshot.operation === 'edit' || snapshot.references.some(ref => !ref.analysisOnly);
    const progress = el('p', 'inline-notice');
    progress.setAttribute('role', 'status');
    actions.prepend(button('MJ 登录与官网设置', 'secondary', () => runAction(() => window.pwWorkbench.openMj())),
      button(manual ? '填入官网并跟踪结果' : '自动提交到 MJ 并取图', 'primary', () => runAction(async () => {
        if (!manual && !confirm('将由工作台替你在 MJ 官网按回车提交一次生成，消耗该账号额度，并有违反 Midjourney 条款的风险。继续？')) return;
        progress.textContent = manual ? '提示词已填入 MJ 窗口。请亲自上传素材（如有）、核对设置并按回车；工作台会等待任务链接并取图（最长 30 分钟）。' : '正在识别本次官网任务并等待四宫格…';
        try { await window.pwWorkbench.generateMj(task.taskId, snapshot.revision); showToast('MJ 结果已导入本批次'); }
        finally { await refreshTasks(true); }
      }), true));
    section.append(actions, progress, el('p', 'inline-notice', '先在独立 MJ 窗口登录，核对模型、速度及默认设置。默认只填入提示词，由你在官网按回车提交。'));
    if (window.pwWorkbench.setMjAutoSubmit) {
      const label = el('label', 'checkbox'), toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = autoSubmit;
      label.append(toggle, document.createTextNode('自动提交纯文字任务（默认关闭；可能违反 Midjourney 服务条款）'));
      toggle.addEventListener('change', () => runAction(async () => {
        try { state.mjSettings = await window.pwWorkbench.setMjAutoSubmit(toggle.checked); }
        finally { renderDetail(); }
      }).catch(() => {}));
      section.append(label);
      if (autoSubmit) section.append(el('p', 'inline-notice warning', '已开启自动提交：Midjourney 服务条款禁止自动化工具，账号可能被警告或封禁。带生产素材或编辑的任务仍需你在官网亲自提交。'));
    }
    if (window.pwWorkbench.pendingMj) {
      const pendingBox = el('div'); section.append(pendingBox);
      window.pwWorkbench.pendingMj(task.taskId, snapshot.revision).then(pending => {
        if (!pending) return;
        const notice = el('div', 'inline-notice warning');
        notice.append(el('p', '', `此版本有一次未核实的 MJ 发送${pending.attemptedAt ? `（${formatDate(pending.attemptedAt)}）` : ''}，为避免重复扣额度已暂停重试。请先到官网核对：已生成就在下方“我已在官网提交”填入任务链接；确认没有生成再清除记录。`),
          button('确认没有生成，清除未核实记录', 'secondary compact', () => {
            if (!confirm('请确认你已在 MJ 官网核对，这一版本确实没有生成任务。清除后可以重新发送。继续？')) return;
            return runAction(async () => { await window.pwWorkbench.clearPendingMj(task.taskId, snapshot.revision); renderDetail(); showToast('已清除未核实记录'); });
          }, true));
        pendingBox.replaceChildren(notice);
      }).catch(() => {});
    }
  } else section.append(actions);
  const handoff = state.handoffs.get(task.taskId, snapshot.revision);
  if (handoff) { const output = el('div', 'handoff-output'); output.append(el('p', 'inline-notice success', `交接包：${handoff.export.directory}`), el('pre', '', handoff.handoff.promptText)); section.append(output); }
  const submission = el('div', 'submission-form'); const url = document.createElement('input'); url.type = 'url'; url.placeholder = '官网任务链接（可选，仅记录，不访问）'; url.setAttribute('aria-label', '官网任务链接');
  submission.append(url, button('我已在官网提交', 'secondary', async () => {
    if (!confirm('仅在你已经亲自在 Midjourney 官网提交后继续。是否记录此次提交？')) return;
    const domainKey = state.pendingSubmissionKeys.get(task.taskId) ?? requestKey(); state.pendingSubmissionKeys.set(task.taskId, domainKey);
    await runAction(async () => { await api(`/api/tasks/${task.taskId}/submissions`, { method: 'POST', body: { revision: snapshot.revision, requestKey: domainKey, websiteUrl: url.value.trim() || null } }); state.pendingSubmissionKeys.delete(task.taskId);
      // The user verified this send on the website, so the unverified-attempt guard is no longer needed.
      await window.pwWorkbench?.clearPendingMj?.(task.taskId, snapshot.revision).catch(() => {}); await refreshTasks(true); showToast('已记录用户提交批次'); });
  }, true)); section.append(submission); return section;
}
function renderRuns(task, snapshot) {
  const section = el('section', 'detail-section'); section.append(el('h3', '', `提交批次 · ${task.runs.length}`));
  for (const run of [...task.runs].reverse()) {
    const card = el('div', 'run-card'), head = el('div', 'run-head'), headText = el('div');
    headText.append(el('strong', '', `批次 ${run.runId.slice(0, 8)}`), el('p', '', `${formatDate(run.submittedAt)} · 版本 ${run.revision} · ${run.state === 'results_imported' ? '已导入结果' : '等待手动导入'}`));
    const results = task.results.filter(result => result.runId === run.runId), selected = results.filter(result => result.selected);
    const exportButton = button(`导出所选 ${selected.length}`, 'secondary compact', () => exportResults(task, run), true); exportButton.disabled = !selected.length;
    if (window.pwWorkbench?.collectMj && run.websiteUrl?.includes('/jobs/')) head.append(button('从 MJ 重新取图', 'secondary compact', () => runAction(async () => {
      await window.pwWorkbench.collectMj(task.taskId, run.runId);
      await refreshTasks(true); showToast('已导入该批次的官网结果');
    }), true));
    head.append(headText, exportButton); card.append(head);
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.multiple = true; input.className = 'visually-hidden'; input.id = `results-${run.runId}`;
    const drop = el('label', 'result-drop'); drop.htmlFor = input.id; drop.append(el('span', '', '选择或拖入这个批次的下载结果'), el('small', '', '归属固定为当前任务、版本和批次，不按文件名猜测。'));
    input.addEventListener('change', () => importResultFiles(task, run, input.files).catch(() => {}));
    for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('is-dragging'); });
    for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('is-dragging'); });
    drop.addEventListener('drop', event => { importResultFiles(task, run, event.dataTransfer.files).catch(() => {}); }); card.append(input, drop);
    if (results.length) { const resultGrid = el('div', 'result-grid'); resultGrid.style.marginTop = '10px'; for (const result of results) resultGrid.append(renderResult(task, result, snapshot)); card.append(resultGrid); }
    section.append(card);
  }
  return section;
}
function renderResult(task, result, snapshot) {
  const card = el('div', `result-card${result.selected ? ' is-selected' : ''}`), image = el('img'); image.src = `/api/assets/${result.sha256}`; image.alt = result.originalName; image.loading = 'lazy';
  const preview = el('button', 'result-preview'); preview.type = 'button'; preview.setAttribute('aria-label', `预览结果：${result.originalName}`); preview.append(image);
  preview.addEventListener('click', () => window.open(image.src, '_blank', 'noopener,noreferrer')); image.addEventListener('error', () => { image.alt = '结果图片损坏或缺失'; });
  const body = el('div', 'result-body'); body.append(el('span', 'result-name', result.originalName), el('span', '', `${result.width} × ${result.height} · ${sizeLabel(result.bytes)}`));
  const label = el('label', 'checkbox'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = result.selected; input.dataset.mutation = '';
  input.addEventListener('change', async () => { const value = input.checked; input.disabled = true; try { await runAction(async () => { await api(`/api/tasks/${task.taskId}/results/${result.resultId}`, { method: 'PUT', body: { selected: value } }); await refreshTasks(true); }); } catch { input.checked = !value; } });
  label.append(input, document.createTextNode('选择导出')); body.append(label);
  const controls = el('div', 'ps-place-controls'), placement = document.createElement('select'); placement.setAttribute('aria-label', 'Photoshop 回传位置');
  const options = snapshot.photoshopContext
    ? [['fit_canvas', '适配原画布'], ...(snapshot.photoshopContext.selectionBounds ? [['fit_selection', '适配原选区']] : []), ['new_document', '新建文档']]
    : [['new_document', '新建文档']];
  for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === (snapshot.photoshopContext?.placement ?? 'new_document'); placement.append(option); }
  controls.append(placement, button('回传 PS', 'secondary compact', () => placeResult(task, snapshot, result, placement.value), true));
  body.append(controls); card.append(preview, body); return card;
}

async function placeResult(task, snapshot, result, placement) {
  const operationId = requestKey();
  await runAction(async () => {
    const data = await api(`/api/tasks/${task.taskId}/results/${result.resultId}/place`, {
      method: 'POST', key: operationId, body: { revision: snapshot.revision, requestId: operationId, placement },
    });
    showToast(`已回传到 Photoshop：${data.placement.layerName}`);
  });
}

async function prepareHandoff(task, snapshot) {
  await runAction(async () => {
    const data = await api(`/api/tasks/${task.taskId}/handoff`, { method: 'POST', body: { revision: snapshot.revision } }); state.handoffs.set(task.taskId, snapshot.revision, data);
    let copied = false; try { await navigator.clipboard.writeText(data.handoff.promptText); copied = true; } catch { /* visible fallback below */ }
    renderDetail(); showToast(copied ? '提示词已复制，交接包已准备' : '交接包已准备；复制受限，请使用页面中的提示词');
  });
}
async function copyText(text, successMessage) {
  try { await navigator.clipboard.writeText(text); showToast(successMessage); }
  catch { showToast('浏览器不允许复制，请手动选择页面中的文本', true); }
}
async function importResultFiles(task, run, fileList) {
  const files = [...fileList]; if (!files.length) return;
  await runAction(async () => {
    const uploads = [];
    for (const file of files) { const saved = await upload(file); uploads.push({ sha256: saved.sha256, originalName: file.name }); }
    await api(`/api/tasks/${task.taskId}/results/import`, { method: 'POST', body: { revision: run.revision, runId: run.runId, uploads } });
    await refreshTasks(true); showToast(`已导入 ${files.length} 张结果`);
  });
}
async function exportPrompt() {
  const { task } = state.selected; const revision = task.head;
  await runAction(async () => { const data = await api(`/api/tasks/${task.taskId}/exports`, { method: 'POST', body: { revision, promptOnly: true } }); state.exports.set(task.taskId, revision, data.export.directory); renderDetail(); showToast('提示词已导出'); });
}
async function exportPackage() {
  const { task } = state.selected; const revision = task.head;
  await runAction(async () => { const data = await api(`/api/tasks/${task.taskId}/exports`, { method: 'POST', body: { revision } }); state.exports.set(task.taskId, revision, data.export.directory); renderDetail(); showToast('任务包已导出'); });
}
async function exportResults(task, run) {
  await runAction(async () => { const data = await api(`/api/tasks/${task.taskId}/exports`, { method: 'POST', body: { revision: run.revision, runId: run.runId } }); state.exports.set(task.taskId, run.revision, data.export.directory); renderDetail(); showToast('所选结果已导出'); });
}
function switchMobilePane(pane) {
  document.body.dataset.mobilePane = pane;
  document.querySelectorAll('.mobile-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pane === pane)));
}

document.querySelectorAll('.mode-btn').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
if (window.pwWorkbench?.showWizard) {
  $('#returnWizardButton').hidden = false;
  $('#returnWizardButton').addEventListener('click', () => window.pwWorkbench.showWizard().catch(error => showToast(error.message, true)));
}
function downloadJson(filename, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#wizardImportButton').addEventListener('click', () => $('#wizardImportFile').click());
const pendingImports = new Map();
$('#wizardImportFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    await runAction(async () => {
      if (file.size > 40 * 1024 * 1024) throw new Error('交换包不能超过 40 MiB');
      const value = JSON.parse(await file.text());
      const body = value.schemaVersion === 'prompt-wizard-exchange/1' ? { exchange: value, mode: state.mode } : { artifact: value, mode: state.mode };
      if (value.target && !confirm(`将返回任务 ${value.target.taskId}，从版本 ${value.target.revision} 保存新版本。继续？`)) return;
      const signature = JSON.stringify(body), key = pendingImports.get(signature) ?? requestKey(); pendingImports.set(signature, key);
      const result = await api('/api/tasks/import-prompt', { method: 'POST', body, key });
      state.selectedTaskId = result.task.taskId; await refreshTasks(true); showToast('提示词产物已导入，请核对参数与素材');
    });
  } catch { /* runAction displays the error and retains the selected file for retry. */ }
  finally { event.target.value = ''; }
});
document.querySelectorAll('.mobile-tabs button').forEach(button => button.addEventListener('click', () => switchMobilePane(button.dataset.pane)));
refs.form.addEventListener('submit', saveTask); $('#resetEditorButton').addEventListener('click', () => resetEditor());
$('#refreshButton').addEventListener('click', () => runAction(() => refreshTasks(true)).then(() => showToast('任务已刷新')).catch(() => {}));
refs.fileInput.addEventListener('change', () => addReferenceFiles(refs.fileInput.files));
for (const type of ['dragenter', 'dragover']) refs.drop.addEventListener(type, event => { event.preventDefault(); refs.drop.classList.add('is-dragging'); });
for (const type of ['dragleave', 'drop']) refs.drop.addEventListener(type, event => { event.preventDefault(); refs.drop.classList.remove('is-dragging'); });
refs.drop.addEventListener('drop', event => addReferenceFiles(event.dataTransfer.files));
for (const id of ['#modelVersionInput', '#speedInput', '#resolutionInput', '#operationInput', '#aspectRatioInput']) $(id).addEventListener('change', () => { if (id === '#operationInput') renderAssets(); else updateCapabilities(); });

const storeLockNotice = el('div', 'inline-notice warning store-lock-notice'); storeLockNotice.hidden = true; storeLockNotice.setAttribute('role', 'alert');
document.body.append(storeLockNotice);
async function checkStoreLock() {
  const { lock } = await api('/api/store/status');
  if (!lock.locked) { storeLockNotice.hidden = true; storeLockNotice.replaceChildren(); return; }
  const text = lock.recoverable
    ? `任务库有一个上次中断留下的写锁${lock.createdAt ? `（${formatDate(lock.createdAt)}）` : ''}，所有保存都会失败。原进程已不存在，可以安全解除。`
    : '任务库正在被另一个进程写入，或锁刚刚创建。请关闭其他正在使用同一数据目录的工作台或 CLI，稍后再检查。';
  storeLockNotice.replaceChildren(el('p', '', text));
  if (lock.recoverable) storeLockNotice.append(button('解除写锁', 'secondary compact', () => runAction(async () => {
    await api('/api/store/recover-lock', { method: 'POST', body: {} }); await checkStoreLock(); await refreshTasks(true); showToast('写锁已解除');
  })));
  else storeLockNotice.append(button('重新检查', 'secondary compact', () => checkStoreLock().catch(error => showToast(error.message, true))));
  storeLockNotice.hidden = false;
}
async function start() {
  try {
    const requestedPane = new URLSearchParams(window.location.search).get('pane');
    if (requestedPane === 'editor' || requestedPane === 'workspace') switchMobilePane(requestedPane);
    const response = await fetch('/api/meta', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`本地服务不可用（${response.status}）`);
    state.meta = await response.json(); refs.connection.textContent = `本机 · ${state.meta.version}`;
    if (window.pwWorkbench?.getMjSettings) state.mjSettings = await window.pwWorkbench.getMjSettings().catch(() => ({ autoSubmit: false }));
    await checkStoreLock().catch(() => {});
    const requestedTask = new URLSearchParams(window.location.search).get('task');
    if (requestedTask) state.selectedTaskId = requestedTask;
    setMode('mj_web'); await refreshTasks(Boolean(requestedTask));
    if (requestedTask && state.selectedTaskId === requestedTask && state.selected) {
      loadEditor(state.selected);
      switchMobilePane('workspace');
    }
  } catch (error) {
    refs.connection.textContent = '连接失败'; refs.connection.style.color = 'var(--danger)'; refs.detail.replaceChildren(el('div', 'inline-notice warning', `${error.message}。请保留输入并刷新页面重试。`));
  }
}
start();
