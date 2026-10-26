import { sourceOf, WORKFLOW_NAMES } from './library-core.mjs'

export function createLibraryUI(React, store) {
  const h = React.createElement, { useState, useEffect, useRef } = React
  const field = 'w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700'
  const box = 'rounded-lg border border-neutral-300 p-4 space-y-3 dark:border-neutral-700'
  const btn = (label, onClick, disabled = false) => h('button', { type: 'button', className: 'rounded-md border border-neutral-400 px-3 py-2 text-sm disabled:opacity-50', onClick, disabled }, label)
  const p = text => h('p', { className: 'text-sm whitespace-pre-wrap' }, text)
  const statuses = { pending: '待 API 整理', queued: '等待文字 API', processing: '正在整理', ready: '已整理 · 待复核', error: '整理失败 · 原文保留' }
  async function request(route = '', body, method) {
    const res = await fetch('/api/library' + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const data = await res.json(); if (!res.ok) throw Error(data.error?.message || '档案请求失败'); return data
  }
  const outboxKey = 'prompt-wizard.library-outbox.v1'
  let outbox = [], saving = false, lastSource = '', saveError = '', lastMessage = ''
  const watchers = new Set(), notify = () => watchers.forEach(fn => fn())
  try { const raw = JSON.parse(localStorage.getItem(outboxKey) || '[]'); if (!Array.isArray(raw) || raw.length > 30) throw Error(); outbox = raw.map(sourceOf) }
  catch { saveError = '本地档案待保存队列异常，未自动覆盖；请导出当前提示词并检查浏览器存储。' }
  function persist() {
    try { localStorage.setItem(outboxKey, JSON.stringify(outbox)); return true }
    catch { saveError = '浏览器临时存储空间不足，请保持程序打开直到档案保存成功。'; notify(); return false }
  }
  async function flush() {
    if (saving) return
    saving = true
    try {
      while (outbox.length) {
        await request('', outbox[0]); outbox.shift(); persist()
      }
      saveError = ''; lastMessage = '提示词已自动入库；可在「档案库」查看整理状态。'
    } catch (e) { saveError = '自动入库暂未完成：' + e.message + '。原提示词不受影响，请重试。' }
    finally { saving = false; notify() }
  }
  function observe(s) {
    if (!s.artifact || s.busy || s.records.compose?.status !== 'ready') return
    let source
    try { source = sourceOf({ workflowId: s.workflowId, artifact: s.artifact }) } catch (e) { saveError = '自动入库失败：' + e.message; notify(); return }
    const key = JSON.stringify(source)
    if (key === lastSource) return
    if (outbox.length >= 30) { saveError = '待保存档案超过 30 条，请先重试保存，当前提示词尚未入库。'; notify(); return }
    lastSource = key
    if (!outbox.some(x => JSON.stringify(x) === key)) { outbox.push(source); persist() }
    void flush()
  }
  store.subscribe(observe)
  // 写入由应用生命周期管理，不受切换页签或 React StrictMode 重挂载影响。
  if (outbox.length) void flush()
  function Banner() {
    const [, tick] = useState(0)
    useEffect(() => { const f = () => tick(x => x + 1); watchers.add(f); return () => watchers.delete(f) }, [])
    if (!saveError && !lastMessage) return null
    return h('div', { role: saveError ? 'alert' : 'status', className: 'mx-auto max-w-3xl px-6 py-2 text-xs' }, saveError || lastMessage, saveError && btn('重试自动入库', () => { lastSource = ''; observe(store.getState()); void flush() }))
  }
  function LibraryPage() {
    const [data, setData] = useState(null), [profiles, setProfiles] = useState([]), [model, setModel] = useState(''), [auto, setAuto] = useState(false), [query, setQuery] = useState(''), [mode, setMode] = useState(''), [trash, setTrash] = useState(false), [selected, setSelected] = useState(''), [detail, setDetail] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
    const selectedRef = useRef(''), alive = useRef(false), loading = useRef(false)
    async function refresh(initialize = false) {
      if (loading.current) return
      loading.current = true
      try {
        const list = await request()
        if (!alive.current) return
        setData(list)
        if (initialize) { setModel(list.settings.profileId); setAuto(list.settings.autoProcess) }
        const id = selectedRef.current
        if (id) { const item = await request('/' + id); if (alive.current && id === selectedRef.current) setDetail(item) }
      } catch (e) { if (alive.current) setError(e.message) }
      finally { loading.current = false }
    }
    useEffect(() => {
      alive.current = true; void refresh(true)
      fetch('/api/iteration/settings').then(r => r.json()).then(d => { if (alive.current) setProfiles(d.profiles || []) }).catch(e => { if (alive.current) setError(e.message) })
      const timer = setInterval(() => void refresh(), 1500)
      return () => { alive.current = false; clearInterval(timer) }
    }, [])
    async function action(fn) {
      if (busy) return
      setBusy(true); setError(''); setMessage('')
      try { await fn(); await refresh() } catch (e) { if (alive.current) setError(e.message) }
      finally { if (alive.current) setBusy(false) }
    }
    async function open(id) {
      selectedRef.current = id; setSelected(id); setDetail(null); setError('')
      try { const item = await request('/' + id); if (alive.current && selectedRef.current === id) setDetail(item) } catch (e) { if (alive.current) setError(e.message) }
    }
    async function copy(value) {
      setError(''); setMessage('')
      try { await navigator.clipboard.writeText(value); setMessage('已复制') } catch { setError('剪贴板不可用，请在下方文本框中手动选择复制。') }
    }
    function exportFile() {
      const r = detail.result
      const body = JSON.stringify({ name: r.name, summary: r.summary, workflowId: detail.source.workflowId, parts: r.parts, warnings: r.warnings }, null, 2)
      const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' })), a = document.createElement('a')
      a.href = url; a.download = r.name.replace(/[\\/:*?"<>|]/g, '-') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    const entries = (data?.entries || []).filter(e => e.trashed === trash && (!mode || e.workflowId === mode) && (e.name + e.summary).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    return h('div', { className: 'space-y-4' }, h('h2', { className: 'font-semibold' }, '可复用提示词档案库'),
      p('生成完成和确认采用的提示词会自动保存原文；预览不会入库。API 删除具体人物描述，保留场景、新增元素与必要互动关系。档案不会替换当前提示词。'),
      h('div', { className: box }, h('h3', { className: 'font-semibold' }, '档案整理模型'),
        h('label', { className: 'block text-sm' }, '使用已保存的文字 API 配置', h('select', { className: field, value: model, disabled: busy, onChange: e => setModel(e.target.value) }, h('option', { value: '' }, '请选择模型'), profiles.map(p => h('option', { key: p.id, value: p.id }, p.name + ' · ' + p.model)))),
        !profiles.length && p('请先在向导最后的「迭代」页添加文字 API 配置，再返回此页。'),
        h('label', { className: 'block text-sm' }, h('input', { type: 'checkbox', checked: auto, disabled: busy, onChange: e => setAuto(e.target.checked) }), ' 新档案自动调用 API 整理和命名（会产生费用）'),
        p('每份新档案通常一次调用，校验失败最多再试一次。开启不批量处理旧待整理档案；关闭会取消尚未开始的自动任务，已发出的调用仍会完成。'),
        btn('保存档案设置', () => action(async () => { await request('/settings', { profileId: model, autoProcess: auto }, 'PUT'); setMessage('档案设置已保存') }), busy || (auto && !model))),
      error && h('p', { role: 'alert', className: 'text-sm text-red-600' }, error), message && h('p', { role: 'status', className: 'text-sm' }, message),
      !!data?.damagedCount && p(`检测到 ${data.damagedCount} 个损坏档案，已保留文件且未覆盖，请检查数据目录。`),
      h('label', { className: 'block text-sm' }, '搜索名称或摘要', h('input', { className: field, value: query, onChange: e => setQuery(e.target.value) })),
      h('label', { className: 'block text-sm' }, '生成路径', h('select', { className: field, value: mode, onChange: e => setMode(e.target.value) }, h('option', { value: '' }, '全部路径'), Object.entries(WORKFLOW_NAMES).map(([id, name]) => h('option', { key: id, value: id }, name)))),
      h('label', { className: 'block text-sm' }, h('input', { type: 'checkbox', checked: trash, onChange: e => { setTrash(e.target.checked); selectedRef.current = ''; setSelected(''); setDetail(null) } }), ' 查看回收站（可恢复）'),
      p(`${entries.length} 份档案`),
      h('div', { className: 'grid gap-3 sm:grid-cols-2' }, entries.map(e => h('button', { key: e.id, type: 'button', 'data-archive-id': e.id, className: box + ' text-left', 'aria-pressed': selected === e.id, onClick: () => void open(e.id) }, h('strong', null, e.name), p(WORKFLOW_NAMES[e.workflowId] + ' · ' + statuses[e.status]), p(e.summary || e.error || '原文已安全保存，尚未得到整理模板。')))),
      detail && h('article', { className: box }, h('h3', { className: 'font-semibold' }, detail.result?.name || '档案原文'),
        p(statuses[detail.status] + ' · ' + new Date(detail.createdAt).toLocaleString()),
        detail.result && h('div', { className: 'space-y-3' }, p(detail.result.summary), p('复用提醒：\n' + detail.result.warnings.join('\n')),
          detail.result.parts.map((part, i) => h('section', { key: part.key, className: box }, h('h4', { className: 'font-semibold' }, part.key), h('textarea', { className: field, rows: 5, readOnly: true, value: part.body, 'aria-label': part.key + '档案正文' }), btn(detail.result.parts.length === 1 ? '复制整理后的提示词' : `复制第 ${i + 1} 步`, () => void copy(part.body)))),
          btn('导出整理档案 JSON', exportFile)),
        detail.error && h('p', { role: 'alert' }, detail.error),
        !detail.trashed && ['pending', 'error'].includes(detail.status) && btn(detail.status === 'error' ? '重试 API 整理' : '使用所选 API 整理并命名', () => action(() => request('/' + detail.id + '/process', { profileId: model })), busy || !model),
        btn(detail.trashed ? '恢复档案' : '移入回收站', () => action(() => request('/' + detail.id, { trashed: !detail.trashed }, 'PUT')), busy || detail.status === 'processing'),
        h('details', null, h('summary', null, '查看原始提示词（未去人物化，仅供核对）'), h('pre', { className: 'whitespace-pre-wrap text-xs' }, detail.source.artifact.prompt))))
  }
  return { Banner, LibraryPage }
}
