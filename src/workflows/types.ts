export type ThinkingPolicy =
  | { mode: 'disabled' }
  | { mode: 'enabled'; effort: 'low' | 'high' | 'max' }

export type StageMode = 'form' | 'auto' | 'choice' | 'hybrid' | 'free'

export type IntakeField = {
  key: string
  label: string
  kind: 'text' | 'textarea' | 'select' | 'multi'
  required: boolean
  placeholder?: string
  options?: string[]
  /** 进入接收阶段时的初始值，用于输出规格这类有合理默认的字段 */
  defaultValue?: string
  /** 仅在另一个字段包含指定值时显示，用于置入物体这类条件化的问题 */
  showWhen?: { field: string; includes: string }
}

/**
 * 条件指令：按接收阶段的取值，往「本次请求」里追加执行要求。
 *
 * 注意这里刻意不叫「条件资产」——资产必须无条件进缓存前缀，
 * 一旦随用户输入增减，前缀就会变，缓存全部落空。所以专项规则
 * 走的是请求级指令，而不是前缀级资产。
 */
export type Directive = {
  when: { field: string; includes: string }
  /** 面向模型的执行指令，写进本次请求 */
  instruction: string
  /** 给用户看的短标签 */
  label: string
}

export type WorkflowStage = {
  id: string
  title: string
  intent: string
  mode: StageMode
  thinking: ThinkingPolicy
  fields?: IntakeField[]
  minOptions?: number
  maxOptions?: number
  outputContract?: OutputContract
}

export type OutputContract = 'four-section-cn' | 'mj-prompt-en'

export type Workflow = {
  id: string
  name: string
  summary: string
  outputContract: OutputContract
  /** 两条线共享的资产，会排在前缀最前面，用来命中同一段缓存 */
  sharedAssets: string[]
  /** 本线专属资产，接在共享资产之后 */
  assets: string[]
  /** 按接收阶段取值追加的请求级指令 */
  directives?: Directive[]
  stages: WorkflowStage[]
}
