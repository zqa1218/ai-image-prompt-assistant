import Stepper from '../components/Stepper.tsx'
import UsageBar from '../components/UsageBar.tsx'
import { resolveDirectives } from '../lib/directives.ts'
import {
  selectedOption,
  useWizard,
  type WizardState,
} from '../lib/wizardStore.ts'
import type { StageRecord } from '../lib/wizardTypes.ts'
import AnalyzeStage from '../stages/AnalyzeStage.tsx'
import ComposeStage from '../stages/ComposeStage.tsx'
import DetailStage from '../stages/DetailStage.tsx'
import DirectionStage from '../stages/DirectionStage.tsx'
import IntakeStage from '../stages/IntakeStage.tsx'
import IterateStage from '../stages/IterateStage.tsx'
import type { WorkflowStage } from '../workflows/types.ts'
import { getWorkflow, WORKFLOWS } from '../workflows/index.ts'

export default function WizardPage() {
  const state = useWizard()

  if (!state.workflowId) {
    return <WorkflowPicker onPick={(id) => state.start(id)} />
  }

  const workflow = getWorkflow(state.workflowId)
  const stage = workflow.stages[state.stageIndex]
  const record = state.records[stage.id]
  const directives = resolveDirectives(workflow, state.intake)
  const isLast = state.stageIndex === workflow.stages.length - 1

  const missingRequired =
    stage.id === 'intake'
      ? (stage.fields ?? [])
          .filter((f) => f.required)
          .filter((f) => !(state.intake[f.key] ?? '').trim())
      : []
  const missingImage = stage.id === 'intake' && !state.original
  const blocker =
    missingImage
      ? '请先选择原图'
      : missingRequired.length > 0
        ? `还缺必填项：${missingRequired.map((f) => f.label).join('、')}`
        : null

  const primaryLabel = LABELS[stage.id] ?? '下一步'
  const primaryDisabled = state.busy || blocker !== null

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{workflow.name}</h2>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {workflow.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm('重新开始会清空当前进度，确定吗？')) state.reset()
          }}
          className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          换一条线
        </button>
      </div>

      <Stepper
        stages={workflow.stages}
        current={state.stageIndex}
        records={state.records}
        onJump={state.goTo}
      />

      {state.providerKind === 'mock' && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <strong className="font-semibold">当前是演示模式</strong>
          ：分析与提示词都是写死的示例文案，<strong className="font-semibold">不会读取你上传的图片</strong>。
          在「设置」页关掉演示模式即可切换到真实模型。
        </p>
      )}

      {state.notice && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
          {state.notice}
        </p>
      )}

      <section>
        <StageBody state={state} stage={stage} record={record} directives={directives} />
      </section>

      <footer className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        {state.stageIndex > 0 && (
          <button
            type="button"
            onClick={() => state.goTo(state.stageIndex - 1)}
            className={secondaryBtn}
          >
            上一步
          </button>
        )}
        {!isLast && (
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={() => void state.advance()}
            className={primaryBtn + (primaryDisabled ? ' opacity-40' : '')}
          >
            {primaryLabel}
          </button>
        )}
        {isLast && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            流程已走完，可以复制提示词，或继续在下方提出修改。
          </span>
        )}
        {blocker && <span className="text-xs text-amber-600 dark:text-amber-400">{blocker}</span>}
      </footer>

      <UsageBar />
    </div>
  )

}

/**
 * 阶段视图放在模块顶层，不要定义在 WizardPage 内部：
 * 组件内部定义的组件每次渲染都是新类型，React 会卸载重挂，输入框会每敲一个字就失焦。
 */
function StageBody({
  state,
  stage,
  record,
  directives,
}: {
  state: WizardState
  stage: WorkflowStage
  record: StageRecord | undefined
  directives: ReturnType<typeof resolveDirectives>
}) {
  const exportName = state.workflowId ? getWorkflow(state.workflowId).name : '提示词'

  switch (stage.id) {
    case 'intake':
      return (
        <IntakeStage
          stage={stage}
          intake={state.intake}
          original={state.original}
          references={state.references}
          directives={directives}
          onIntake={state.setIntake}
          onOriginal={state.setOriginal}
          onAddReference={state.addReference}
          onRemoveReference={state.removeReference}
        />
      )
    case 'analyze':
      return (
        <AnalyzeStage
          running={record?.status === 'running'}
          text={(record?.output as string | undefined) ?? ''}
          error={record?.error}
          referenceItems={state.referenceItems}
          selectedIds={state.selectedReferenceItems}
          onToggleItem={state.toggleReferenceItem}
          onRerun={() => void state.rerun()}
        />
      )
    case 'direction':
      return (
        <DirectionStage
          running={record?.status === 'running'}
          options={state.options}
          selectedId={state.selectedOptionId}
          error={record?.error}
          onSelect={state.selectOption}
          onRerun={() => void state.rerun()}
        />
      )
    case 'detail':
      return (
        <DetailStage
          selected={selectedOption(state)}
          notes={state.notes}
          messages={state.messages}
          busy={state.busy}
          onAsk={state.addNote}
        />
      )
    case 'compose':
      return (
        <ComposeStage
          running={record?.status === 'running'}
          artifact={state.artifact}
          error={record?.error}
          exportName={exportName}
          onRerun={() => void state.rerun()}
        />
      )
    case 'iterate':
      return (
        <IterateStage
          artifact={state.artifact}
          messages={state.messages}
          busy={state.busy}
          exportName={exportName}
          onSubmit={state.sendFeedback}
        />
      )
    default:
      return null
  }
}

const LABELS: Record<string, string> = {
  intake: '开始分析',
  analyze: '下一步：方向建议',
  direction: '下一步：细化',
  detail: '生成提示词',
  compose: '下一步：迭代',
}

function WorkflowPicker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">选择工作路径</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          两条线共享同一套分析流程，区别在于原图的角色与最终产出的提示词。
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {WORKFLOWS.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            onClick={() => onPick(workflow.id)}
            className="rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
          >
            <h3 className="text-sm font-semibold">{workflow.name}</h3>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
              {workflow.summary}
            </p>
            <p className="mt-3 text-[11px] text-neutral-400 dark:text-neutral-500">
              {workflow.stages.length} 个阶段 · 输出
              {workflow.outputContract === 'four-section-cn' ? '中文四段式' : '英文 MJ 提示词'}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

const primaryBtn =
  'rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 ' +
  'disabled:cursor-not-allowed dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white'

const secondaryBtn =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 ' +
  'dark:border-neutral-700 dark:hover:bg-neutral-800'
