/**
 * 把「置入物体待定项清单」补丁应用到压缩后的前端 bundle。
 * 只做字符串级替换，每处都断言命中唯一，避免误伤。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = 'W:/dsh/pw-analyze'
const SRC = process.argv[2] ?? `${ROOT}/patch/index-original.js`
const OUT = process.argv[3] ?? `${ROOT}/patch/dist/index-CsLE5G_q.js`
const EDITS = `${ROOT}/patch/edits`

const read = (p) => readFileSync(path.join(EDITS, p), 'utf8').replace(/\r/g, '').replace(/\n+$/, '')

let code = readFileSync(SRC, 'utf8')
const original = code.length
const log = []

function countOf(haystack, needle) {
  let n = 0
  let at = 0
  while ((at = haystack.indexOf(needle, at)) !== -1) { n += 1; at += needle.length }
  return n
}

function must(cond, message) {
  if (!cond) {
    console.error(`✗ ${message}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------- E1: detail 阶段新增「待定项清单」输出契约
{
  const head = 'return t.id===`detail`?'
  const tail = ':`简洁作答。不要输出 json。`}'
  const start = code.indexOf(head)
  must(start >= 0, 'E1 找不到 detail 分支起点')
  const tailAt = code.indexOf(tail, start)
  must(tailAt > start, 'E1 找不到 detail 分支终点')
  const end = tailAt + tail.length
  const before = code.slice(start, end)
  must(before.includes('最多追问三个问题'), 'E1 命中的片段不像原 detail 分支')
  code = code.slice(0, start) + read('new_gu_detail.js') + code.slice(end)
  log.push(`E1 detail 输出契约 +${read('new_gu_detail.js').length - before.length} 字符`)
}

// ---------------------------------------------------------------- E2: provider 增加 askChecklist
{
  const anchor = 'async compose(e){return Gu(e)}'
  must(countOf(code, anchor) === 1, `E2 锚点命中 ${countOf(code, anchor)} 次（应为 1）`)
  code = code.replace(anchor, read('insert_askchecklist.js') + ',' + anchor)
  log.push('E2 provider.askChecklist 已插入')
}

// ---------------------------------------------------------------- E3: store 增加 questions 状态
{
  const anchor = 'messages:[],notice:null,busy:!1}'
  must(countOf(code, anchor) === 1, `E3 锚点命中 ${countOf(code, anchor)} 次（应为 1）`)
  code = code.replace(anchor, 'messages:[],notice:null,busy:!1,questions:[],research:null}')
  log.push('E3 store 初始状态 +questions +research')
}

// ---------------------------------------------------------------- E4: store 增加 loadChecklist / answerChecklist
{
  const anchor = 'async sendFeedback(n){'
  must(countOf(code, anchor) === 1, `E4 锚点命中 ${countOf(code, anchor)} 次（应为 1）`)
  code = code.replace(anchor, read('insert_actions.js') + anchor)
  log.push('E4 store 动作 +loadChecklist +answerChecklist')
}

// ---------------------------------------------------------------- E5: detail 分支把新 props 传给组件
{
  const old = 'case`detail`:return(0,B.jsx)(Wd,{selected:ld(e),notes:e.notes,messages:e.messages,busy:e.busy,onAsk:e.addNote});'
  must(countOf(code, old) === 1, `E5 锚点命中 ${countOf(code, old)} 次（应为 1）`)
  code = code.replace(old, read('new_call_site.js'))
  log.push('E5 组件调用点已扩展 props')
}

// ---------------------------------------------------------------- E6: 替换细化组件实现
{
  const start = code.indexOf('function Wd({selected:e,notes:t,messages:n,busy:r,onAsk:i}){')
  const end = code.indexOf('function Gd({option:e,selected:t,onSelect:n}){')
  must(start > 0 && end > start, 'E6 找不到 Wd / Gd 边界')
  must(code.slice(start, end).includes('补充要求，或问一个关于写法的具体问题'), 'E6 片段不是细化组件')
  const component = read('component_panels.js') + '\n' + read('component.js')
  must(component.includes('function parseChecklistItems'), 'E6 组件文件缺少解析函数')
  must(component.includes('function ResearchPanel'), 'E6 缺少 ResearchPanel')
  code = code.slice(0, start) + component + '\n' + code.slice(end)
  log.push(`E6 细化/资料/确认 组件已注入（${end - start} → ${component.length} 字符）`)
}

// ---------------------------------------------------------------- E7: 接收阶段新增「提示词写法」二选一（数据驱动字段）
{
  const anchor = 'placeholder:`必须保留什么、绝对不能改什么`}]},'
  const hits = countOf(code, anchor)
  must(hits >= 1, 'E7 找不到 constraints 字段结尾')
  const field = read('insert_workflow_field.js')
  code = code.split(anchor).join('placeholder:`必须保留什么、绝对不能改什么`},' + field + ']},')
  log.push(`E7 接收阶段新增「提示词写法」字段（命中 ${hits} 处工作流）`)
}

// ---------------------------------------------------------------- E8: compose 输出契约按模式分支
{
  const anchor = 'r=mu(e)?`置入物体是独立模式'
  must(countOf(code, anchor) === 1, `E8 锚点命中 ${countOf(code, anchor)} 次（应为 1）`)
  const at = code.indexOf(anchor)
  const close = code.indexOf('`:n.outputContract===', at)
  must(close > at, 'E8 找不到 compose 分支结尾')
  const synthetic = read('compose_branch_synthetic.js')
  const reference = read('compose_branch_reference.js')
  const expression =
    'r=mu(e)?(String((e.intake&&e.intake.referencePolicy)||``).indexOf(`参考图参与`)>=0?`' +
    reference +
    '`:`' +
    synthetic +
    '`)'
  code = code.slice(0, at) + expression + code.slice(close + 1)
  log.push('E8 compose 输出契约按「置景合成 / 参考图参与」分支')
}

// ---------------------------------------------------------------- E9: 后处理按模式决定是否消隐参考图，并统一剥离 [cite: N]
{
  const start = code.indexOf('i=t=>{let n=Eu(t.trim());')
  must(start > 0, 'E9 找不到提示词后处理')
  const end = code.indexOf(';return r.ok?', start)
  must(end > start, 'E9 找不到后处理结尾')
  must(code.slice(start, end).includes('Du(n'), 'E9 命中的片段不含 Du(n)')
  code = code.slice(0, start) + read('postprocess.js') + code.slice(end)
  log.push('E9 后处理：参考图参与模式跳过消隐，全模式剥离 [cite: N]')
}

// ---------------------------------------------------------------- E10: 参考重构线（MJ）只输出「正面 / 负面」分块
{
  const anchor = 'if(t.id===`compose`){if(au(e))return H;'
  must(countOf(code, anchor) === 1, `E10 锚点命中 ${countOf(code, anchor)} 次（应为 1）`)
  code = code.replace(anchor, anchor + read('mj_contract.js'))
  log.push('E10 compose：mj-prompt-en 走正面/负面分块契约')
}

// ---------------------------------------------------------------- E11: 产物带 sections（每块可单独复制）
{
  const start = code.indexOf('return r.ok?{prompt:i(r.data.prompt)')
  must(start > 0, 'E11 找不到 compose 返回结构')
  const tail = '以上为原始输出`}}'
  const at = code.indexOf(tail, start)
  must(at > start, 'E11 找不到 compose 返回结构结尾')
  const end = at + tail.length
  code = code.slice(0, start) + read('mj_parse.js') + code.slice(end)
  log.push('E11 compose 产物 +sections，prompt 回退到第一条正向')
}

// ---------------------------------------------------------------- E12: compose 的 JSON schema 允许 sections
{
  const old = 'ru=Ls({prompt:R().min(1),channel:R().optional(),params:Fs(R()).optional(),checklist:Fs(R()).optional()})'
  must(countOf(code, old) === 1, `E12 锚点命中 ${countOf(code, old)} 次（应为 1）`)
  code = code.replace(
    old,
    'ru=Ls({prompt:R().min(1),channel:R().optional(),params:Fs(R()).optional(),checklist:Fs(R()).optional(),sections:Fs(Ls({key:R().min(1),body:R().min(1)})).optional()})',
  )
  log.push('E12 compose schema 允许 sections（否则 zod 会剥掉）')
}

// ---------------------------------------------------------------- E13: 参考重构线接收阶段加「角色名称 / 出自作品」
{
  const intent = '收集参考图与目标需求。'
  const at = code.indexOf(intent)
  must(at > 0, 'E13 找不到参考重构线的接收意图')
  const key = 'fields:['
  const fieldsAt = code.indexOf(key, at)
  must(fieldsAt > at && fieldsAt - at < 240, 'E13 找不到该工作流的字段数组')
  code = code.slice(0, fieldsAt + key.length) + read('insert_fields.js') + code.slice(fieldsAt + key.length)
  log.push('E13 参考重构线 +角色名称 +出自作品')
}

// ---------------------------------------------------------------- E14: 反向拆解阶段挂「待确认项」面板
{
  const old = 'case`analyze`:return(0,B.jsx)(Ad,{running:n?.status===`running`,text:n?.output??``,error:n?.error,referenceItems:e.referenceItems,selectedIds:e.selectedReferenceItems,onToggleItem:e.toggleReferenceItem,onRerun:()=>void e.rerun()});'
  must(countOf(code, old) === 1, `E14 锚点命中 ${countOf(code, old)} 次（应为 1）`)
  const inner = old.slice('case`analyze`:return'.length, -1)
  code = code.replace(old,
    'case`analyze`:return(0,B.jsxs)(`div`,{className:`space-y-4`,children:[(0,B.jsx)(ConfirmPanel,{questions:e.questions,busy:e.busy,onLoad:e.loadChecklist,onAnswer:e.answerChecklist,onNext:function(){e.advance()}}),' + inner + ']});')
  log.push('E14 反向拆解 +待确认项面板')
}

// ---------------------------------------------------------------- E15: 接收阶段挂「资料收集」面板
{
  const old = 'case`intake`:return(0,B.jsx)(Qd,{stage:t,intake:e.intake,original:e.original,references:e.references,directives:r,onIntake:e.setIntake,onOriginal:e.setOriginal,onAddReference:e.addReference,onRemoveReference:e.removeReference});'
  must(countOf(code, old) === 1, `E15 锚点命中 ${countOf(code, old)} 次（应为 1）`)
  const inner = old.slice('case`intake`:return'.length, -1)
  code = code.replace(old,
    'case`intake`:return(0,B.jsxs)(`div`,{className:`space-y-4`,children:[e.original?(0,B.jsx)(ResearchPanel,{research:e.research,busy:e.busy,intake:e.intake,onLoad:e.loadResearch,onApply:e.applyResearch,onAnswer:e.answerChecklist}):null,' + inner + ']});')
  log.push('E15 接收 +资料收集面板（有原图后出现）')
}

// ---------------------------------------------------------------- E16: 每次开始一条线换一个新对话
{
  const anchor = 'async function hl(e){'
  must(countOf(code, anchor) === 1, `E16 找不到对话 id 生成函数`)
  code = code.replace(anchor, 'var rh=String(Date.now());' + anchor)

  const tail = '.join(``)}`'
  const start = code.indexOf(anchor)
  const at = code.indexOf(tail, start)
  must(at > start, 'E16 找不到 id 模板结尾')
  code = code.slice(0, at) + '.join(``)}-${rh}`' + code.slice(at + tail.length)
  log.push('E16 对话 id 追加运行标记（每次开始新线即新对话）')

  const pickOld = 'e({...rd,workflowId:t,intake:r})'
  must(countOf(code, pickOld) === 1, 'E16 找不到选择工作流的动作')
  code = code.replace(pickOld, 'rh=String(Date.now()),e({...rd,workflowId:t,intake:r})')

  const archiveOld = 'return e({...rd,workflowId:n.id'
  must(countOf(code, archiveOld) === 1, 'E16 找不到载入存档的动作')
  code = code.replace(archiveOld, 'rh=String(Date.now()),e({...rd,workflowId:n.id')
  log.push('E16 选择工作流 / 载入存档时刷新运行标记')
}

// ---------------------------------------------------------------- E17: 设置页 API 加供应商快捷预设
{
  const anchor = '(0,B.jsxs)(`label`,{className:`block text-sm`,children:[`API 地址`'
  must(countOf(code, anchor) === 1, `E17 锚点命中 ${countOf(code, anchor)} 次（应为 1）`)
  code = code.replace(anchor, read('insert_api_presets.js') + anchor)
  log.push('E17 设置页 +DeepSeek / MiniMax / 自定义 预设')
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, code, 'utf8')
console.log(log.join('\n'))
console.log(`\n原始 ${original} 字符 → 补丁后 ${code.length} 字符`)
console.log(`输出：${OUT}`)
