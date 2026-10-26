import { targets } from './iteration-core.mjs'
import { MODEL_PRESETS, presetForm } from './model-presets.mjs'

export function createIterationUI(React, store, PromptOutput) {
  const h = React.createElement
  const { useState, useEffect, useRef } = React
  const box = 'rounded-lg border border-neutral-300 p-4 space-y-3 dark:border-neutral-700'
  const field = 'w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700'
  const button = 'rounded-md border border-neutral-400 px-3 py-2 text-sm disabled:opacity-50'
  const para = text => h('p', { className: 'text-sm whitespace-pre-wrap' }, text)
  const btn = (label, onClick, disabled = false) => h('button', { type: 'button', className: button, onClick, disabled }, label)
  async function request(path, body, signal) {
    const res = await fetch('/api/iteration/' + path, { method: body === undefined ? 'GET' : path === 'settings' ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || '文字 API 请求失败')
    return data
  }
  function Config({ profiles, selected, setSelected, refresh, busy }) {
    const blank = { id: '', name: '', baseUrl: '', model: '', format: 'json_object', apiKey: '' }
    const [form, setForm] = useState(blank), [error, setError] = useState(''), [saving, setSaving] = useState(false)
    useEffect(() => { const p = profiles.find(p => p.id === selected); if (p) setForm({ id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model, format: p.format, apiKey: '' }); else setForm(current => current.id ? blank : current) }, [selected, profiles])
    function input(key, label, placeholder, type = 'text') {
      return h('label', { className: 'block text-sm' }, label, h('input', { className: field, type, value: form[key], placeholder, autoComplete: 'off', maxLength: key === 'apiKey' ? 4096 : 1000, disabled: saving || busy, onChange: e => setForm({ ...form, [key]: e.target.value }) }))
    }
    async function save() {
      if (saving || busy) return
      setSaving(true); setError('')
      try { const data = await request('settings', form); refresh(data.profiles); setSelected(data.savedId); setForm({ ...form, apiKey: '' }) }
      catch (e) { setError(e.message) } finally { setSaving(false) }
    }
    return h('details', { className: box, open: profiles.length === 0 ? true : undefined },
      h('summary', { className: 'cursor-pointer text-sm font-semibold' }, '文字 API 配置（独立于前面的看图通道）'),
      para('支持 OpenAI Chat Completions 兼容接口；其它原生协议需使用兼容端点。可保存多组服务和模型。保存不调用上游；每轮分析和生成各调用一次，校验失败最多额外重试一次。'),
      h('label', { className: 'block text-sm' }, '一键模型预设', h('select', { className: field, value: '', disabled: busy || saving, onChange: e => { if (e.target.value) { setSelected(''); setForm(presetForm(e.target.value)); setError('') } } }, h('option', { value: '' }, '选择预设 → 填写 API Key → 保存配置'), MODEL_PRESETS.map(p => h('option', { key: p.id, value: p.id }, p.name)))),
      para('预设不会覆盖已保存配置，切换预设会清空未保存的 Key，避免密钥串到其它服务。此处使用开放平台 API Key；网页会员／Coding Plan 是否可用以服务商授权为准。'),
      MODEL_PRESETS.filter(p => p.baseUrl === form.baseUrl && p.model === form.model).map(p => h('p', { key: p.id, className: 'text-sm' }, p.note)),
      h('label', null, '编辑配置', h('select', { className: field, value: selected, disabled: busy || saving, onChange: e => setSelected(e.target.value) }, h('option', { value: '' }, '新建配置'), profiles.map(p => h('option', { key: p.id, value: p.id }, p.name + ' · ' + p.model)))),
      input('name', '配置名称', '例如：提示词优化模型'), input('baseUrl', 'API 基础地址', 'https://你的服务地址/v1'), input('model', '模型 ID', '填写服务实际支持的模型 ID'), input('apiKey', 'API Key', form.id ? '留空保留已保存的 Key；换地址须重新填写' : '远程服务必填，本机免密服务可留空', 'password'),
      h('label', null, '结构化输出能力', h('select', { className: field, value: form.format, disabled: saving || busy, onChange: e => setForm({ ...form, format: e.target.value }) }, h('option', { value: 'json_object' }, 'JSON Object（兼容模式）'), h('option', { value: 'json_schema' }, 'JSON Schema（模型支持时使用）'), h('option', { value: 'prompt' }, '仅提示词约束（仍进行本地严格校验）'))),
      btn(saving ? '保存中…' : '保存配置', save, saving || busy), error && h('p', { role: 'alert' }, error))
  }

  function Target({ target, state, profileId, onApply }) {
    const [requirement, setRequirement] = useState(''), [analysis, setAnalysis] = useState(null), [chosen, setChosen] = useState(''), [preview, setPreview] = useState(null), [error, setError] = useState(''), [phase, setPhase] = useState('')
    const pending = useRef(null), serial = useRef(0), alive = useRef(true)
    const baseline = useRef({ artifact: state.artifact, intake: state.intake, notes: state.notes, references: state.references, workflowId: state.workflowId, stageIndex: state.stageIndex })
    function current() {
      const s = store.getState(), b = baseline.current
      return alive.current && Object.keys(b).every(k => s[k] === b[k])
    }
    function cancel() { serial.current++; if (pending.current) { pending.current.abort(); pending.current = null; store.setState({ busy: false }) } setPhase('') }
    useEffect(() => { alive.current = true; return () => { alive.current = false; serial.current++; if (pending.current) { pending.current.abort(); pending.current = null; store.setState({ busy: false }) } } }, [])
    useEffect(() => { setAnalysis(null); setChosen(''); setPreview(null); setError('') }, [profileId])
    async function run(kind) {
      if (store.getState().busy || !current() || !profileId || !requirement.trim()) return
      if (kind === 'generate' && (!analysis || !chosen || analysis.conflicts.length)) return
      const controller = new AbortController(), seq = ++serial.current
      pending.current = controller; store.setState({ busy: true }); setPhase(kind); setError(''); setPreview(null)
      try {
        let body
        if (kind === 'analyze') {
          setAnalysis(null); setChosen('')
          const notes = (state.notes || []).map(n => typeof n === 'string' ? n : n.text || '').join('\n')
          const option = (state.options || []).find(o => o.id === state.selectedOptionId)
          body = { profileId, workflowId: state.workflowId, artifact: state.artifact, targetId: target.id, requirement: requirement.trim(), intake: state.intake, context: ['原分析：' + (state.records.analyze?.output || ''), '原选定方向：' + (option ? JSON.stringify(option) : ''), '补充约束：' + notes].join('\n'), references: (state.references || []).map((r, i) => ({ number: i + 1, note: r.note || '' })) }
        } else body = { ticket: analysis.ticket, directionId: chosen }
        const data = await request(kind, body, controller.signal)
        if (seq !== serial.current || !current()) return
        if (kind === 'analyze') setAnalysis(data)
        else setPreview(data)
      } catch (e) { if (seq === serial.current && current()) setError(e.name === 'AbortError' ? '已取消，原提示词未改动。' : e.message) }
      finally { if (seq === serial.current) { pending.current = null; store.setState({ busy: false }); if (alive.current) setPhase('') } }
    }
    return h('section', { className: box },
      h('h3', { className: 'font-semibold' }, target.label + ' · 独立优化'),
      h('details', null, h('summary', null, '查看当前优化对象'), h('pre', { className: 'whitespace-pre-wrap text-xs' }, target.body)),
      h('label', { className: 'block text-sm' }, '本轮新要求', h('textarea', { className: field, rows: 3, maxLength: 8000, value: requirement, disabled: state.busy, placeholder: '描述希望改变的内容，以及必须保留的部分', onChange: e => { setRequirement(e.target.value); setAnalysis(null); setChosen(''); setPreview(null); setError('') } })),
      btn(phase === 'analyze' ? '正在分析…' : '分析要求并给出 3 个方向', () => run('analyze'), state.busy || !profileId || !requirement.trim()),
      phase && btn('取消本次请求', cancel),
      error && h('p', { role: 'alert', className: 'text-sm text-red-600' }, error),
      analysis && h('div', { className: 'space-y-3' }, h('h4', { className: 'font-semibold' }, '分析与修改方向 · ' + analysis.model), para(analysis.analysis),
        analysis.conflicts.length > 0 && h('div', { role: 'alert' }, para('以下冲突需先处理：请修改新要求后重新分析。'), analysis.conflicts.map((c, i) => h('p', { key: i }, c))),
        analysis.directions.map(d => h('label', { key: d.id, className: 'block rounded-md border border-neutral-300 p-3 text-sm' },
          h('input', { type: 'radio', name: 'direction-' + target.id, value: d.id, checked: chosen === d.id, disabled: state.busy || !!preview || analysis.conflicts.length > 0, onChange: () => { setChosen(d.id); setPreview(null) } }), ' ' + d.title + (d.id === analysis.recommendedId ? '（推荐）' : ''), para('修改：' + d.changes), para('预期：' + d.expected), para('风险：' + d.risk))),
        btn(phase === 'generate' ? '正在生成…' : '按选定方向生成新版', () => run('generate'), state.busy || !chosen || analysis.conflicts.length > 0 || !!preview)),
      preview && h('div', { className: 'space-y-3' }, h('h4', { className: 'font-semibold' }, '新版预览（尚未替换原文）'), para(preview.changes.join('\n')), preview.warnings.length > 0 && para('需要复核：\n' + preview.warnings.join('\n')),
        h('details', { open: true }, h('summary', null, '修改前后对比'), h('div', { className: 'grid gap-3 sm:grid-cols-2' }, h('div', null, para('修改前'), h('pre', { className: 'whitespace-pre-wrap text-xs' }, target.body)), h('div', null, para('修改后'), h('pre', { className: 'whitespace-pre-wrap text-xs' }, targets(state.workflowId, preview.artifact).find(t => t.id === target.id).body)))),
        btn('确认采用新版', () => { if (current()) onApply(preview.artifact, `${target.label}：${requirement}\n方向：${analysis.directions.find(d => d.id === chosen).title}\n模型：${preview.model}`); else setError('当前提示词已变化，请重新分析') }, state.busy),
        btn('放弃预览', () => { setPreview(null); setAnalysis(null); setChosen('') }, state.busy)))
  }

  function Iteration({ state, exportName }) {
    const [profiles, setProfiles] = useState([]), [selected, setSelected] = useState(''), [loadError, setLoadError] = useState(''), [history, setHistory] = useState([])
    const expected = useRef(state.artifact)
    useEffect(() => { let active = true; request('settings').then(data => { if (active) { setProfiles(data.profiles); setSelected(data.profiles[0]?.id || '') } }).catch(e => { if (active) setLoadError(e.message) }); return () => { active = false } }, [])
    useEffect(() => { if (expected.current !== state.artifact) { setHistory([]); expected.current = state.artifact } }, [state.artifact])
    function replace(artifact, note, remember = true) {
      const live = store.getState()
      if (live.busy || live.artifact !== state.artifact) return
      if (remember) setHistory([...history.slice(-9), live.artifact])
      expected.current = artifact
      store.setState({ artifact, records: { ...live.records, compose: { status: 'ready', output: artifact } }, messages: [...live.messages, { id: 'iteration-' + crypto.randomUUID(), role: 'assistant', text: note }], notice: note })
    }
    let items = [], parseError = ''
    try { if (state.artifact) items = targets(state.workflowId, state.artifact) } catch (e) { parseError = e.message }
    // 模型切换、输入变化、采用任意一步后均废弃旧分析，避免把旧方向套到新上下文。
    const revisionKey = JSON.stringify([state.workflowId, state.artifact, state.intake, state.notes, state.references.map(r => r.note || ''), profiles])
    return h('div', { className: 'space-y-4' }, h('h2', { className: 'font-semibold' }, '文字 API · 提示词迭代'),
      para('只发送当前提示词、需求、分析摘要和参考图文字分工，不上传图片。先分析、再选择方向，最后预览并确认采用。离开本页会取消请求并清除未采用的预览。'),
      h(Config, { profiles, selected, setSelected, refresh: setProfiles, busy: state.busy }),
      loadError && h('p', { role: 'alert' }, loadError),
      h('label', { className: 'block text-sm' }, '本轮使用的文字模型', h('select', { className: field, value: selected, disabled: state.busy, onChange: e => setSelected(e.target.value) }, h('option', { value: '' }, '请选择／先配置模型'), profiles.map(p => h('option', { key: p.id, value: p.id }, p.name + ' · ' + p.model)))),
      para('配置只选择兼容接口，不代表模型必然支持 JSON Schema；不支持时请选择 JSON Object 或仅提示词约束。程序始终执行本地校验。'),
      parseError && h('p', { role: 'alert' }, parseError),
      h('div', { key: revisionKey, className: 'space-y-4' }, items.map(target => h(Target, { key: target.id + selected, target, state, profileId: selected, onApply: replace }))),
      history.length > 0 && btn('撤回上一次采用（本页保留最近 10 版）', () => { const previous = history.at(-1); replace(previous, '已撤回上一次文字优化。', false); setHistory(history.slice(0, -1)) }, state.busy),
      state.artifact && h(PromptOutput, { artifact: state.artifact, exportName }))
  }
  function ModelSettings() {
    const [profiles, setProfiles] = useState([]), [selected, setSelected] = useState(''), [error, setError] = useState('')
    useEffect(() => { let active = true; request('settings').then(d => { if (active) setProfiles(d.profiles) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [])
    return h('div', { className: 'mt-6 space-y-3' }, h('h2', { className: 'font-semibold' }, '提示词迭代与档案库 · 文字模型预设'), para('无需先生成提示词：选预设、填 Key 并保存后，迭代页和档案库均可选择这份配置。不会改变前面的看图通道，也不会自动开启付费整理。'), error && h('p', { role: 'alert' }, error), h(Config, { profiles, selected, setSelected, refresh: setProfiles, busy: false }))
  }
  Iteration.Settings = ModelSettings
  return Iteration
}
