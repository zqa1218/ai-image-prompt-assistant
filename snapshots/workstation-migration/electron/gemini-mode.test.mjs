import { afterEach, expect, it, vi } from 'vitest'
import { inspectMode, ensureMode } from './gemini-mode.mjs'

afterEach(() => vi.unstubAllGlobals())

function fixture({ custom = false, selected = 'task', aria = false, group = true, placeholder = '' } = {}) {
  const parent = {}
  const node = text => ({
    innerText: text, className: '', attrs: {}, parentElement: parent,
    getClientRects: () => [1],
    getAttribute(name) { return this.attrs[name] ?? null },
    contains(other) { return this === other || this.child === other },
    querySelector() { return this.child || null },
    click: vi.fn(),
  })
  const chat = node('对话'), task = node('任务')
  const chosen = selected === 'chat' ? chat : task
  if (custom) { chat.child = node('对话'); task.child = node('任务') }
  if (aria) (chosen.child || chosen).attrs['aria-pressed'] = 'true'
  else chosen.className = custom ? 'gem-segmented-button-selected' : 'selected'
  const container = { getClientRects: () => [1], contains: n => n === chat || n === task }
  const controls = [chat, task, chat.child, task.child].filter(Boolean)
  const editor = node('')
  editor.attrs['data-placeholder'] = placeholder
  vi.stubGlobal('document', { querySelectorAll: selector => selector.includes('contenteditable') ? [editor] : selector.includes('dialog') ? [] : selector.includes('button,') ? controls : group ? [container] : [] })
  return { chat, task }
}

it('recognizes paired custom controls and their inner ARIA state', () => {
  fixture({ custom: true, aria: true })
  expect(inspectMode('task', false)).toBe('selected')
})

it('supports paired ordinary buttons without relying on vertical position', () => {
  fixture({ aria: true, group: false })
  expect(inspectMode('task', false)).toBe('selected')
})

it('clicks only requested mode, never treats unselected as selected', () => {
  const { task } = fixture({ custom: true, selected: 'chat' })
  task.className = 'unselected'
  expect(inspectMode('task', true)).toBe('switched')
  expect(task.child.click).toHaveBeenCalledOnce()
  expect(inspectMode('task', false)).toBe('mismatch')
})

it('explicit false ARIA overrides selected class and conflicting states fail closed', () => {
  const { chat, task } = fixture()
  task.attrs['aria-selected'] = 'false'
  expect(inspectMode('task', false)).toBe('mismatch')
  task.attrs['aria-selected'] = 'true'
  chat.className = 'selected'
  expect(inspectMode('task', false)).toBe('ambiguous')
})

it('does not click a disabled control', () => {
  const { task } = fixture({ selected: 'chat' })
  task.disabled = true
  expect(inspectMode('task', true)).toBe('disabled')
  expect(task.click).not.toHaveBeenCalled()
})

it('task editor metadata can confirm unknown styling, but cannot override explicit unselected state', () => {
  const { task } = fixture({ placeholder: '描述任务' })
  task.className = 'new-style'
  expect(inspectMode('task', false)).toBe('selected')
  task.attrs['aria-selected'] = 'false'
  expect(inspectMode('task', false)).toBe('mismatch')
})

it('task placeholder cannot override the opposite mode or confirm chat', () => {
  fixture({ selected: 'chat', placeholder: '描述任务' })
  expect(inspectMode('task', false)).toBe('mismatch')
  const { task } = fixture({ placeholder: '描述任务' })
  task.className = ''
  expect(inspectMode('chat', false)).toBe('mismatch')
})

/**
 * 新版 Gemini 只在“新对话”页渲染 对话/任务 开关，
 * 历史对话页整页没有该控件 —— 这是第二张图之后每次提交都会遇到的真实页面。
 */
function conversationFixture({ placeholder = '', ariaLabel = '' } = {}) {
  const editor = {
    innerText: '',
    className: '',
    attrs: {},
    getClientRects: () => [1],
    getAttribute(name) {
      return this.attrs[name] ?? null
    },
  }
  if (placeholder) editor.attrs['data-placeholder'] = placeholder
  if (ariaLabel) editor.attrs['aria-label'] = ariaLabel
  vi.stubGlobal('document', {
    querySelectorAll: (selector) => (selector.includes('contenteditable') ? [editor] : []),
  })
  return editor
}

it('历史对话页没有模式开关时，用输入框类型确认模式', () => {
  conversationFixture({ placeholder: '问问 Gemini' })
  expect(inspectMode('chat', false)).toBe('selected')
  expect(inspectMode('task', false)).toBe('unpaired')

  conversationFixture({ ariaLabel: '为 Gemini 输入提示' })
  expect(inspectMode('chat', false)).toBe('selected')

  conversationFixture({ placeholder: '描述任务' })
  expect(inspectMode('task', false)).toBe('selected')
  expect(inspectMode('chat', false)).toBe('unpaired')
})

it('输入框类型也读不到时依旧不放行', () => {
  conversationFixture()
  expect(inspectMode('chat', false)).toBe('absent')
  expect(inspectMode('chat', true)).toBe('absent')
})

it('发现历史对话是另一种模式时立即报错，不等待、不点击', async () => {
  const read = vi.fn(async () => 'unpaired')
  await expect(ensureMode(read, 'chat', clock())).rejects.toThrow('另一种模式建立')
  expect(read).toHaveBeenCalledOnce()
})

function clock() {
  let time = 0
  return { timeout: 1800, now: () => time, sleep: async ms => { time += ms } }
}

it('waits for initial loading and post-click rerenders; clicks at most once', async () => {
  const states = ['absent', 'switched', 'absent', 'mismatch', 'selected', 'selected']
  const read = vi.fn(async () => states.shift())
  await expect(ensureMode(read, 'task', clock())).resolves.toBe('selected')
  expect(read.mock.calls.map(args => args[0])).toEqual([true, true, false, false, false, false])
})

it('retries the requested mode when the first page click is lost', async () => {
  let time = 0
  let clicks = 0
  const read = vi.fn(async change => {
    if (change) {
      clicks += 1
      return 'switched'
    }
    return clicks >= 2 ? 'selected' : 'mismatch'
  })
  await expect(ensureMode(read, 'task', {
    timeout: 4000,
    now: () => time,
    sleep: async ms => { time += ms },
  })).resolves.toBe('selected')
  expect(clicks).toBe(2)
})

it('read-only verification never changes modes and explains timeouts', async () => {
  const read = vi.fn(async () => 'absent')
  await expect(ensureMode(read, 'task', { ...clock(), change: false })).rejects.toThrow('未找到成对的对话/任务开关')
  expect(read.mock.calls.every(args => args[0] === false)).toBe(true)
})

it('consent stops immediately; transient selected state is insufficient', async () => {
  await expect(ensureMode(async () => 'consent', 'task', clock())).rejects.toThrow('任务授权尚未完成')
  let count = 0
  await expect(ensureMode(async () => ++count === 1 ? 'selected' : 'mismatch', 'task', clock())).rejects.toThrow('未读到目标模式')
})
