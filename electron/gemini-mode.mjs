/**
 * Runs in the page. 模式判定有两个证据源：
 * 1) 成对的「对话 / 任务」开关（只在新对话页渲染）；
 * 2) 输入框自身的类型提示（对话是“问问 Gemini / 为 Gemini 输入提示”，任务是“描述任务”）。
 *
 * 历史对话页整页都没有那个开关，只能靠 2)。这里的判断只用来确认模式，
 * 从不代替用户改写模式。
 */
export function inspectMode(mode, change) {
  const visible = node => node && node.getClientRects().length > 0
  const label = node => (node.getAttribute('aria-label') || node.innerText || '').trim().replace(/\s+/g, ' ')
  const names = { chat: ['对话', '聊天', 'Chat'], task: ['任务', 'Task'] }
  const kind = node => Object.keys(names).find(key => names[key].includes(label(node)))

  // 占位提示先读，读不到才退回 aria-label：任务输入框的 aria-label 可能仍是通用文案。
  const composerKind = () => {
    const hints = { chat: ['问问 Gemini', 'Ask Gemini', '输入提示'], task: ['描述任务', 'Describe a task'] }
    const editors = [...document.querySelectorAll('[contenteditable="true"], textarea')].filter(visible)
    const read = (attrs) => {
      for (const node of editors) {
        for (const attr of attrs) {
          const value = (node.getAttribute(attr) || '').trim()
          if (!value) continue
          const found = Object.keys(hints).find(key => hints[key].some(hint => value.includes(hint)))
          if (found) return found
        }
      }
      return ''
    }
    return read(['data-placeholder', 'placeholder', 'aria-placeholder']) || read(['aria-label'])
  }

  const dialogs = [...document.querySelectorAll('[role="dialog"], mat-dialog-container')].filter(visible)
  if (dialogs.some(node => /代表你执行操作|与第三方共享|让我们开始吧/.test(node.innerText || ''))) return 'consent'
  const controls = [...document.querySelectorAll('gem-segmented-button, button, [role="tab"], [role="radio"]')]
    .filter(node => visible(node) && kind(node))
  // Prefer the custom element over its duplicate inner button.
  const unique = controls.filter(node => !controls.some(parent => parent !== node && parent.contains(node)))
  const groups = [...document.querySelectorAll('gem-segmented-button-row, [role="group"], [role="tablist"], [role="radiogroup"]')].filter(visible)
  let pairs = groups.map(group => unique.filter(node => group.contains(node)))
    .filter(nodes => nodes.length === 2 && nodes.some(node => kind(node) === 'chat') && nodes.some(node => kind(node) === 'task'))
  if (!pairs.length && unique.length === 2 && unique[0].parentElement === unique[1].parentElement && kind(unique[0]) !== kind(unique[1])) pairs = [unique]
  const targets = [...new Set(pairs.flatMap(nodes => nodes.filter(node => kind(node) === mode)))]
  if (targets.length > 1) return 'ambiguous'
  if (!targets.length) {
    // 新版 Gemini 只在“新对话”页渲染 对话/任务 开关，历史对话页没有这个控件。
    // 历史对话的模式在建对话时就定死了（本助手自己建的对话必然是本方案的模式），
    // 所以这里用输入框类型做一次交叉验证：对得上就放行，读不到照旧报错，绝不猜。
    const hint = composerKind()
    if (!hint) return 'absent'
    return hint === mode ? 'selected' : 'unpaired'
  }
  const target = targets[0]
  const selected = node => {
    const states = [node, node.querySelector('button, [role="tab"], [role="radio"]')].filter(Boolean)
    const aria = states.flatMap(item => ['aria-selected', 'aria-checked', 'aria-pressed'].map(attr => item.getAttribute(attr))).filter(value => value === 'true' || value === 'false')
    if (aria.length) return aria.includes('true') && !aria.includes('false')
    return states.some(item => /(?:^|\s)(?:selected|active|gem-segmented-button-selected)(?:\s|$)/.test(String(item.className))) ? true : null
  }
  const opposite = [...new Set(pairs.flat())].filter(node => kind(node) !== mode)
  if (selected(target)) return opposite.some(selected) ? 'ambiguous' : 'selected'
  // 开关在、但选中样式读不出来时，同样用输入框类型交叉验证：
  // 只读编辑器属性，绝不读用户输入，也不覆盖明确的“未选中”状态。
  if (selected(target) === null && !opposite.some(selected) && composerKind() === mode) return 'selected'
  if (!change) return 'mismatch'
  const button = target.querySelector('button') || target
  if (button.disabled || button.getAttribute('aria-disabled') === 'true') return 'disabled'
  button.click()
  return 'switched'
}

export async function ensureMode(read, mode, { change = true, timeout = 15000, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + timeout
  let clicks = 0
  let nextClick = 0
  let stable = 0
  let state = 'absent'
  do {
    const canClick = change && clicks < 3 && now() >= nextClick
    state = await read(canClick)
    if (state === 'consent') throw new Error('Gemini 任务授权尚未完成，请在网页中阅读并自行确认；本次未发送，也未切换模型')
    // 历史对话的模式改不了，等下去也不会变，直接报错并给出下一步。
    if (state === 'unpaired') throw modeFailure(mode, state)
    if (state === 'switched') {
      clicks += 1
      nextClick = now() + 1500
    }
    stable = state === 'selected' ? stable + 1 : 0
    if (stable >= 2) return state
    await sleep(300)
  } while (now() < deadline)
  throw modeFailure(mode, state)
}

function modeFailure(mode, state) {
  const reasons = {
    absent: '未找到成对的对话/任务开关（这个对话页不渲染该控件，也读不到输入框类型）',
    mismatch: '未读到目标模式的选中状态',
    ambiguous: '页面有多个或冲突的模式状态',
    disabled: '目标模式开关不可用',
    switched: '点击后尚未确认',
    selected: '模式状态尚未稳定',
    unpaired: '这个历史对话是另一种模式建立的，对话内没有开关可以切回去',
  }
  const advice = state === 'unpaired'
    ? '；请点“对话跑偏，重开”新建对话，或改用与这个对话一致的方案'
    : '；未自动更换方案'
  return new Error(
    `无法确认 Gemini 已进入${mode === 'task' ? '任务' : '对话'}模式，已停止发送：${reasons[state] || '页面状态无法识别'}${advice}`,
  )
}
