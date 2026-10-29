import Stepper from "../components/Stepper.tsx";
import UsageBar from "../components/UsageBar.tsx";
import { confirmAction } from "../lib/confirmDialog.ts";
import { focusIntakeRequirement } from "../lib/intakeFocus.ts";
import { resolveDirectives } from "../lib/directives.ts";
import {
  selectedOption,
  useWizard,
  type WizardState,
} from "../lib/wizardStore.ts";
import type { StageRecord } from "../lib/wizardTypes.ts";
import AnalyzeStage from "../stages/AnalyzeStage.tsx";
import ComposeStage from "../stages/ComposeStage.tsx";
import DetailStage from "../stages/DetailStage.tsx";
import DirectionStage from "../stages/DirectionStage.tsx";
import IntakeStage from "../stages/IntakeStage.tsx";
import IterateStage from "../stages/IterateStage.tsx";
import type { WorkflowStage } from "../workflows/types.ts";
import { getWorkflow, WORKFLOWS } from "../workflows/index.ts";

export default function WizardPage({ onArchives }: { onArchives: () => void }) {
  const state = useWizard();

  if (!state.workflowId) {
    return <WorkflowPicker onPick={(id) => state.start(id)} onArchives={onArchives} />;
  }

  const workflow = getWorkflow(state.workflowId);
  const stage = workflow.stages[state.stageIndex];
  const record = state.records[stage.id];
  const directives = resolveDirectives(workflow, state.intake);
  const isLast = state.stageIndex === workflow.stages.length - 1;

  const missingRequired =
    stage.id === "intake"
      ? (stage.fields ?? [])
          .filter((f) => f.required)
          .filter((f) => !(state.intake[f.key] ?? "").trim())
      : [];
  const missingImage = stage.id === "intake" && !state.original;
  const blocker = missingImage
    ? "请先选择原图"
    : missingRequired.length > 0
      ? `还缺必填项：${missingRequired.map((f) => f.label).join("、")}`
      : null;

  const primaryLabel = LABELS[stage.id] ?? "下一步";
  const primaryDisabled = state.busy || blocker !== null;

  return (
    <div className="space-y-5" key={state.taskId}>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{workflow.name}</h2>
          <button type="button" className="mt-1 text-xs text-accent underline" onClick={onArchives}>保存输入 / 载入</button>
        </div>
        <button
          type="button"
          onClick={async () => {
            const ok = await confirmAction({
              title: "换一条线？",
              message: "重新开始会清空当前进度，已保存的存档不受影响。",
              confirmLabel: "重新开始",
            });
            if (ok) state.reset();
          }}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs hover:bg-ink-750 border-line-strong dark:hover:bg-ink-700"
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

      {state.providerKind === "mock" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <strong className="font-semibold">当前是演示模式</strong>
          ：分析与提示词都是写死的示例文案，
          <strong className="font-semibold">不会读取你上传的图片</strong>。
          在「设置」页关掉演示模式即可切换到真实模型。
        </p>
      )}

      {state.notice && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
          {state.notice}
        </p>
      )}

      <section>
        <StageBody
          state={state}
          stage={stage}
          record={record}
          directives={directives}
        />
      </section>

      <footer className="wizard-actions flex flex-wrap items-center gap-3">
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
            className={primaryBtn + (primaryDisabled ? " opacity-40" : "")}
          >
            {primaryLabel}
          </button>
        )}
        {isLast && (
          <>
            <button
              type="button"
              onClick={async () => {
                const ok = await confirmAction({
                  title: "开始下一张图？",
                  message: "会清空当前的底图与产出，修图需求保留，接着改就行。",
                  confirmLabel: "下一张图",
                });
                if (!ok) return;
                state.nextRound();
                focusIntakeRequirement();
              }}
              className={primaryBtn}
            >
              下一张图
            </button>
            {state.references.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: "开始下一张图并沿用当前参考图？",
                    message: "会清空底图与产出，修图需求与参考图都保留。",
                    confirmLabel: "沿用参考图",
                  });
                  if (!ok) return;
                  state.nextRound(true);
                  focusIntakeRequirement();
                }}
                className={secondaryBtn}
              >
                下一张图（沿用参考图）
              </button>
            )}
            <span className="text-xs text-fg-muted text-fg-muted">
              流程已走完：先复制提示词，再点「下一张图」开始下一轮。
            </span>
          </>
        )}
        {blocker && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {blocker}
          </span>
        )}
      </footer>

      <UsageBar />
    </div>
  );
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
  state: WizardState;
  stage: WorkflowStage;
  record: StageRecord | undefined;
  directives: ReturnType<typeof resolveDirectives>;
}) {
  const exportName = state.workflowId
    ? getWorkflow(state.workflowId).name
    : "提示词";

  switch (stage.id) {
    case "intake":
      return (
        <IntakeStage
          stage={stage}
          intake={state.intake}
          original={state.original}
          references={state.references}
          directives={directives}
          busy={state.busy}
          research={state.research}
          persona={state.persona}
          onIntake={state.setIntake}
          onOriginal={state.setOriginal}
          onAddReference={state.addReference}
          onRemoveReference={state.removeReference}
          onReferenceNote={state.setReferenceNote}
          onLoadResearch={state.loadResearch}
          onApplyResearch={state.applyResearch}
          onLoadPersona={state.loadPersona}
          onAnswerChecklist={state.answerChecklist}
          onCopy={(text) => void navigator.clipboard?.writeText(text)}
        />
      );
    case "analyze":
      return (
        <AnalyzeStage
          running={record?.status === "running"}
          text={(record?.output as string | undefined) ?? ""}
          error={record?.error}
          referenceItems={state.referenceItems}
          selectedIds={state.selectedReferenceItems}
          onToggleItem={state.toggleReferenceItem}
          onRerun={() => void state.rerun()}
          questions={state.questions}
          busy={state.busy}
          onLoadChecklist={state.loadChecklist}
          onAnswerChecklist={state.answerChecklist}
          onNext={() => void state.advance()}
        />
      );
    case "direction":
      return (
        <DirectionStage
          running={record?.status === "running"}
          options={state.options}
          selectedId={state.selectedOptionId}
          error={record?.error}
          onSelect={state.selectOption}
          onRerun={() => void state.rerun()}
        />
      );
    case "detail":
      return (
        <DetailStage
          selected={selectedOption(state)}
          notes={state.notes}
          messages={state.messages}
          busy={state.busy}
          questions={state.questions}
          onAsk={state.addNote}
          onLoadChecklist={state.loadChecklist}
          onAnswerChecklist={state.answerChecklist}
        />
      );
    case "compose":
      return (
        <ComposeStage
          running={record?.status === "running"}
          artifact={state.artifact}
          error={record?.error}
          exportName={exportName}
          onRerun={() => void state.rerun()}
        />
      );
    case "iterate":
      return (
        <IterateStage
          artifact={state.artifact}
          messages={state.messages}
          busy={state.busy}
          exportName={exportName}
          onSubmit={state.sendFeedback}
        />
      );
    default:
      return null;
  }
}

const LABELS: Record<string, string> = {
  intake: "开始分析",
  analyze: "下一步：方向建议",
  direction: "下一步：细化",
  detail: "生成提示词",
  compose: "下一步：迭代",
};

function WorkflowPicker({ onPick, onArchives }: { onPick: (id: string) => void; onArchives: () => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">选择工作路径</h2>
        <p className="mt-1 text-sm text-fg-muted text-fg-muted">
          三条线共享同一套分析流程，区别在于原图的角色、最终提示词的形态，以及是否按三步分别复制。
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {WORKFLOWS.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            onClick={() => onPick(workflow.id)}
            className="rounded-xl border border-line p-4 text-left transition-colors hover:border-line-strong border-line hover:border-line-strong"
          >
            <h3 className="text-sm font-semibold">{workflow.name}</h3>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted text-fg-muted">
              {workflow.summary}
            </p>
            <p className="mt-3 text-xs text-fg-dim text-fg-dim">
              {workflow.stages.length} 个阶段 · 输出
              {workflow.outputContract === "mj-prompt-en"
                ? "英文 MJ 提示词"
                : workflow.outputContract === "complete-cn"
                  ? "完整中文修图 Prompt"
                  : "中文四段式"}
            </p>
          </button>
        ))}
      </div>
      <button type="button" className="text-accent underline" onClick={onArchives}>从存档载入输入</button>
    </div>
  );
}

const primaryBtn =
  // 之前残留了 dark:hover:bg-ink-800：鼠标移到主按钮上会突然变黑，
  // 与"这是主操作"的语义相反。主按钮统一强调色 + 提亮。
  "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-900 hover:brightness-110 " +
  "disabled:cursor-not-allowed";

const secondaryBtn =
  "rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-ink-750 " +
  "border-line-strong dark:hover:bg-ink-700";
