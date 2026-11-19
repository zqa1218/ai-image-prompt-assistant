import { createInstalledExchange, recommendedMode, isNewCompletedPrompt } from './exchange.mjs';
import { analyzedOnce, sourceSummary } from './source-switch.mjs';

let wizard;
let autoEnabled = false;
try { autoEnabled = localStorage.getItem('pw041.workbench.auto') === 'true'; } catch {}
const pending = new Map();
const node = (tag, text) => { const result = document.createElement(tag); if (text) result.textContent = text; return result; };
const button = text => { const result = node('button', text); result.type = 'button'; return result; };
const status = () => { const result = node('p'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite'); return result; };
const api = () => { if (!window.pwShell?.importWorkbench) throw new Error('请使用桌面版打开工作台'); return window.pwShell; };

async function transfer(state, artifact, mode, selectedParameterIndex) {
  const exchange = createInstalledExchange(state, artifact, selectedParameterIndex);
  const request = { exchange, mode, sourceId: state.taskId };
  // Coalesce rapid clicks (including auto + manual), but allow retry after any failure.
  const key = JSON.stringify(request);
  if (pending.has(key)) return pending.get(key);
  const promise = api().importWorkbench(request).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

class WorkbenchOutput extends HTMLElement {
  set artifact(value) { const changed = this.value !== value; this.value = value; if (changed) this.render(); }
  connectedCallback() { this.render(); }
  disconnectedCallback() { this.unsubscribe?.(); }
  render() {
    if (!this.isConnected || !this.value || !wizard) return;
    this.unsubscribe?.(); this.replaceChildren(); this.className = 'pw-workbench-output';
    const title = node('strong', '在工作台继续');
    const row = node('div'); row.className = 'pw-workbench-actions';
    const label = node('label', '目标 '), select = node('select'); select.setAttribute('aria-label', '目标工作台');
    for (const [value, text] of [['mj_web', 'MJ 工作台'], ['banana_api', 'Banana 草稿']]) { const option = node('option', text); option.value = value; select.append(option); }
    select.value = recommendedMode(wizard.getState()); label.append(select);
    const send = button('导入并进入工作台'); send.className = 'pw-workbench-primary';
    const message = status();
    const params = node('select'); params.setAttribute('aria-label', '导入参数方案');
    const none = node('option', '参数留到工作台核对'); none.value = ''; params.append(none);
    (this.value.params ?? []).forEach((text, index) => { const option = node('option', `${index + 1}. ${text}`); option.value = String(index); params.append(option); });
    let sending = false;
    const refresh = () => { send.disabled = sending || wizard.getState().busy || wizard.getState().artifact !== this.value; };
    this.unsubscribe = wizard.subscribe(refresh);
    send.addEventListener('click', async () => {
      sending = true; refresh(); select.disabled = params.disabled = true; message.textContent = '正在导入…';
      try { const result = await transfer(wizard.getState(), this.value, select.value, params.value === '' ? null : Number(params.value)); message.textContent = result.message; }
      catch (error) { message.textContent = `${error.message}。提示词已保留，可重试。`; }
      finally { sending = false; refresh(); select.disabled = params.disabled = false; }
    });
    row.append(label, send); this.append(title, row);
    if (this.value.params?.length) this.append(params);
    this.append(node('p', '同时带入图片、需求与生成记录，进入后可继续核对和编辑。'), message);
    refresh();
  }
}
customElements.define('pw-workbench-output', WorkbenchOutput);

export function bindWizard(store) {
  wizard = store;
  const nav = document.getElementById('pw-workbench-nav');
  const open = button('打开工作台');
  const label = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = autoEnabled;
  const long = node('span', '生成完成后'); long.className = 'pw-wb-long';
  label.append(check, long, document.createTextNode('自动进入工作台'));
  const message = status();
  open.addEventListener('click', async () => { try { await api().openWorkbench(); } catch (error) { message.textContent = error.message; } });
  check.addEventListener('change', () => { autoEnabled = check.checked; try { localStorage.setItem('pw041.workbench.auto', String(autoEnabled)); } catch {} });
  const title = node('span', '提示词助手 0.4.1 · 工作台版'); title.className = 'pw-wb-title';
  open.className = 'pw-wb-open';
  nav.append(title, label, open, message);
  setupShell(store);
  // Only a newly completed generation triggers navigation; toggling the switch or changing pages does not.
  store.subscribe((current, previous) => {
    if (!isNewCompletedPrompt(current, previous, autoEnabled)) return;
    message.textContent = '提示词已生成，正在导入工作台…';
    transfer(current, current.artifact, recommendedMode(current), null)
      .then(result => { message.textContent = result.message; })
      .catch(error => { message.textContent = `自动导入失败：${error.message}。可在最终提示词旁重试。`; });
  });
}

// ── 外观：窄面板标记、分析来源标签、中途换来源确认 ──
// 0.4.1 只有压缩后的界面代码，这里只在它的 DOM 外面加东西：不改它的状态逻辑，切换仍走它自己的下拉框。
const MODE_SELECT = 'select[aria-label="生成通道"]';
const optionText = select => select?.selectedOptions?.[0]?.textContent?.trim() ?? '';
const optionLabel = (select, value) => [...(select?.options ?? [])].find(option => option.value === value)?.textContent?.trim() ?? value;

function syncNarrow() {
  const root = document.documentElement;
  const media = window.matchMedia('(max-width: 520px)');
  const apply = () => root.toggleAttribute('data-pw-narrow', root.dataset.shell === 'narrow' || media.matches);
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-shell'] });
  media.addEventListener('change', apply);
  apply();
}

function askSwitch(from, to) {
  return new Promise(resolve => {
    const dialog = node('dialog'); dialog.className = 'pw-dialog'; dialog.setAttribute('aria-label', '换分析来源');
    const actions = node('div'); actions.className = 'pw-dialog-actions';
    const choices = [['cancel', '取消'], ['keep', '只换来源，继续当前步骤'], ['restart', '换来源并重新分析']];
    for (const [value, text] of choices) {
      const choice = button(text); choice.value = value;
      if (value === 'restart') choice.className = 'pw-primary';
      choice.addEventListener('click', () => dialog.close(value));
      actions.append(choice);
    }
    dialog.append(node('h2', `从「${from}」换成「${to}」？`),
      node('p', '当前任务已经分析过。重新分析会清除模型的旧结论，保留图片、需求与补充，回到第一步；只换来源会让后面的步骤改用新来源，旧结论保留。'),
      actions);
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue || 'cancel'); });
    document.body.append(dialog);
    dialog.showModal();
    actions.lastElementChild.focus();
  });
}

function setupShell(store) {
  syncNarrow();
  const root = document.documentElement;
  const chip = button(''); chip.className = 'pw-source-chip';
  chip.setAttribute('aria-haspopup', 'true'); chip.setAttribute('aria-expanded', 'false'); chip.title = '分析来源';
  const dot = node('span'); dot.className = 'pw-dot'; dot.setAttribute('aria-hidden', 'true');
  const text = node('span'); text.className = 'pw-chip-text';
  const tag = node('span', '演示'); tag.className = 'pw-chip-tag'; tag.hidden = true;
  const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  caret.setAttribute('width', '12'); caret.setAttribute('height', '12'); caret.setAttribute('viewBox', '0 0 12 12'); caret.setAttribute('aria-hidden', 'true');
  caret.innerHTML = '<path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  chip.append(dot, text, tag, caret);

  let knownMode = null, lastMode = null, bypass = false, queued = false, keyMissing = false;
  // 下拉框看不出 API Key 有没有填；默认来源是 API，没填 Key 时标签要直接说出来。
  const refreshKey = () => fetch('/api/settings', { cache: 'no-store' })
    .then(response => (response.ok ? response.json() : null))
    .then(settings => { const missing = Boolean(settings && settings.mode === 'api' && !settings.hasKey); if (missing !== keyMissing) { keyMissing = missing; schedule(); } })
    .catch(() => {});
  const bar = () => document.querySelector('.transport-bar');
  const isOpen = () => root.dataset.pwSource === 'open';
  const setOpen = open => {
    if (open) root.dataset.pwSource = 'open'; else delete root.dataset.pwSource;
    chip.setAttribute('aria-expanded', String(open));
    const more = bar()?.querySelector('.transport-more');
    if (more && open) more.open = true;
  };

  const update = () => {
    queued = false;
    const section = bar();
    if (!section) { if (isOpen()) setOpen(false); return; }
    if (chip.parentElement !== section) { section.prepend(chip); refreshKey(); }
    const mode = section.querySelector(MODE_SELECT);
    const thinking = section.querySelector('select[aria-label="Gemini 思考等级"]');
    if (mode) knownMode = mode.value;
    const demo = [...section.querySelectorAll(':scope > p:not([role])')].some(p => p.textContent.includes('演示'));
    const status = section.querySelector(':scope > p[role=status]')?.textContent ?? '';
    const failed = Boolean(status) && !status.startsWith('正在保存') && !status.startsWith('已切到');
    const noKey = !failed && !demo && keyMissing && mode?.value === 'api';
    const state = demo ? 'demo' : failed || noKey ? 'error' : 'ok';
    // 设置没读出来时 0.4.1 会锁住下拉框并显示默认值，标签不能照抄那些假值。
    const label = failed && mode?.disabled && !store.getState().busy ? '来源设置读取失败' : sourceSummary({
      mode: optionText(mode),
      plan: optionText(section.querySelector('select[aria-label="网页方案"]')),
      api: optionText(section.querySelector('select[aria-label="API 预设"]')),
      thinking: optionText(thinking), thinkingValue: thinking?.value ?? '',
    }) + (noKey ? ' · 未填 Key' : '') || '读取来源…';
    if (text.textContent !== label) text.textContent = label;
    chip.title = failed ? `分析来源：${status}` : `分析来源：${label}`;
    if (chip.dataset.state !== state) chip.dataset.state = state;
    tag.hidden = !demo;
    chip.toggleAttribute('data-busy', Boolean(store.getState().busy || mode?.disabled));
  };
  // 用 setTimeout 而不是 requestAnimationFrame：隐藏窗口（含冒烟验收）里 rAF 不会触发。
  const schedule = () => { if (!queued) { queued = true; setTimeout(update, 30); } };

  chip.addEventListener('click', () => { setOpen(!isOpen()); refreshKey(); });
  document.addEventListener('pointerdown', event => {
    if (isOpen() && !bar()?.contains(event.target) && !event.target.closest?.('.pw-dialog')) setOpen(false);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen() && !document.querySelector('.pw-dialog[open]')) { setOpen(false); chip.focus(); }
  });

  // 记住切换前的来源，便于取消时还原下拉框。
  const remember = event => { if (event.target.matches?.(MODE_SELECT)) lastMode = event.target.value; };
  document.addEventListener('focusin', remember, true);
  document.addEventListener('pointerdown', remember, true);

  // 任务分析过以后换来源：先在 React 收到 change 之前拦下，问清楚是重新分析还是继续。
  window.addEventListener('change', async event => {
    const select = event.target;
    if (bypass || !(select instanceof HTMLSelectElement) || !select.matches(MODE_SELECT)) return;
    if (!analyzedOnce(store.getState())) return;
    const next = select.value, previous = lastMode ?? knownMode;
    if (!previous || previous === next) return;
    event.stopImmediatePropagation();
    select.value = previous;
    const choice = await askSwitch(optionLabel(select, previous), optionLabel(select, next));
    if (choice === 'cancel' || !select.isConnected) return;
    bypass = true;
    try { select.value = next; select.dispatchEvent(new Event('change', { bubbles: true })); }
    finally { bypass = false; }
    lastMode = next;
    if (choice === 'restart') { store.getState().restartModelContext(); window.scrollTo({ top: 0 }); }
    schedule();
  }, true);

  document.addEventListener('change', () => { schedule(); setTimeout(schedule, 400); setTimeout(() => { refreshKey(); schedule(); }, 1500); });
  new MutationObserver(schedule).observe(document.getElementById('root'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  store.subscribe(schedule);
  setInterval(schedule, 2000);
  schedule();
}
