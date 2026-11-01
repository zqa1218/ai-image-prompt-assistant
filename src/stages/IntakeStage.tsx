import ImageDropzone from "../components/ImageDropzone.tsx";
import PhotoshopImportButton from "../components/PhotoshopImportButton.tsx";
import { appendConstraint } from "../lib/intakeLayout.ts";
import RefPlanPanel from "../components/RefPlanPanel.tsx";
import ResearchPanel from "../components/ResearchPanel.tsx";
import type { ResolvedDirective } from "../lib/directives.ts";
import { visibleFields } from "../lib/fields.ts";
import { formatBytes, mimeOf } from "../lib/image.ts";
import type { PersonaPayload, ResearchPayload } from "../lib/llm/parsers.ts";
import {
  isAllSelected,
  parseMulti,
  setMultiAll,
  toggleMulti,
} from "../lib/multiValue.ts";
import {
  type ImageRef,
  type WizardImage,
} from "../lib/wizardTypes.ts";
import type { IntakeField, WorkflowStage } from "../workflows/types.ts";

type Props = {
  stage: WorkflowStage;
  intake: Record<string, string>;
  original: WizardImage | null;
  references: WizardImage[];
  directives: ResolvedDirective[];
  busy: boolean;
  research: ResearchPayload | null;
  persona: PersonaPayload | null;
  onIntake: (key: string, value: string) => void;
  onOriginal: (image: ImageRef | null) => void;
  onAddReference: (image: ImageRef) => void;
  onRemoveReference: (index: number) => void;
  onReferenceNote: (index: number, note: string) => void;
  onLoadResearch: () => unknown;
  onApplyResearch: (fill: Record<string, string>) => unknown;
  onLoadPersona: () => unknown;
  onAnswerChecklist: (text: string) => void;
  onCopy: (text: string) => void;
};

export default function IntakeStage({
  stage,
  intake,
  original,
  references,
  directives,
  busy,
  research,
  persona,
  onIntake,
  onOriginal,
  onAddReference,
  onRemoveReference,
  onReferenceNote,
  onLoadResearch,
  onApplyResearch,
  onLoadPersona,
  onAnswerChecklist,
  onCopy,
}: Props) {
  const fields = visibleFields(stage, intake);

  // 只有带角色字段的线路才需要资料收集；缺的必选项直接在这里算，
  // 让面板自己决定按钮是否可用，而不是在提交时才报错。
  const supportsResearch = (stage.fields ?? []).some(
    (field) => field.key === "characterName",
  );
  const gateKeys = ["compositeMode", "renderScope"].filter((key) =>
    (stage.fields ?? []).some((field) => field.key === key),
  );
  const missing = gateKeys
    .filter((key) => !(intake[key] ?? "").trim())
    .map(
      (key) =>
        (stage.fields ?? []).find((field) => field.key === key)?.label ?? key,
    );

  const renderField = (field: IntakeField) => (
          field.kind === "multi" ? (
            <fieldset key={field.key} className="space-y-2">
              <legend className="flex w-full items-baseline gap-2 text-sm font-medium">
                {field.label}
                {field.required && (
                  <span className="text-xs text-red-500">必填</span>
                )}
                <span className="text-xs font-normal text-fg-dim">可多选</span>
                {(field.options?.length ?? 0) > 1 && (
                  <span className="ml-auto flex gap-2 font-normal">
                    <button
                      type="button"
                      className={miniBtn}
                      onClick={() =>
                        onIntake(
                          field.key,
                          setMultiAll(
                            intake[field.key],
                            field.options ?? [],
                            !isAllSelected(
                              intake[field.key],
                              field.options ?? [],
                            ),
                          ),
                        )
                      }
                    >
                      {isAllSelected(intake[field.key], field.options ?? [])
                        ? "取消全选"
                        : "全选"}
                    </button>
                    {parseMulti(intake[field.key]).length > 0 && (
                      <button
                        type="button"
                        className={miniBtn}
                        onClick={() =>
                          onIntake(
                            field.key,
                            setMultiAll(
                              intake[field.key],
                              field.options ?? [],
                              false,
                            ),
                          )
                        }
                      >
                        清空
                      </button>
                    )}
                  </span>
                )}
              </legend>
              <div className="flex flex-wrap gap-2">
                {field.options?.map((option) => {
                  const checked = parseMulti(intake[field.key]).includes(
                    option,
                  );
                  return (
                    <label key={option} className="cursor-pointer">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={checked}
                        onChange={() =>
                          onIntake(
                            field.key,
                            toggleMulti(intake[field.key], option),
                          )
                        }
                      />
                      <span className={chipClass}>{option}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <div key={field.key} className="space-y-1.5">
              {/* 用 htmlFor 显式绑定而不是用 label 包住控件：包住时点击标签的
 转发依赖浏览器默认行为，窗口焦点异常时会点不进去，用户就会
 觉得「修图需求打不了字」。 */}
              <label
                htmlFor={`intake-${field.key}`}
                className="flex cursor-text items-baseline gap-2 text-sm font-medium"
              >
                {field.label}
                {field.required && (
                  <span className="text-xs text-red-500">必填</span>
                )}
              </label>
              {field.kind === "select" ? (
                <select
                  id={`intake-${field.key}`}
                  data-intake-field={field.key}
                  value={intake[field.key] ?? ""}
                  onChange={(e) => onIntake(field.key, e.target.value)}
                  className={inputClass}
                >
                  <option value="">未指定</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.kind === "textarea" ? (
                <textarea
                  id={`intake-${field.key}`}
                  data-intake-field={field.key}
                  rows={3}
                  value={intake[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => onIntake(field.key, e.target.value)}
                  className={inputClass + " resize-y"}
                />
              ) : (
                <input
                  id={`intake-${field.key}`}
                  data-intake-field={field.key}
                  value={intake[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => onIntake(field.key, e.target.value)}
                  className={inputClass}
                />
              )}
            </div>
          )
  );
  const byKey = (key: string) => fields.find(field => field.key === key);
  const renderKey = (key: string) => { const field = byKey(key); return field ? renderField(field) : null; };
  const researchKeys = ['characterName', 'sourceWork', 'castingNote', 'compositeMode', 'renderScope'];
  const advanced = fields.filter(field => field.group === 'requirement' && !['requirement', 'preserve', ...researchKeys].includes(field.key));
  const preserve = stage.fields?.find(field => field.key === 'preserve');
  return <fieldset disabled={busy} className="intake-layout">
    <section className="intake-original surface-row p-4 space-y-3">
      <h2 className="section-title">底图 <span className="text-xs text-warn">必填</span></h2>
      {original ? <ImageCard image={original} label="底图" caption="编辑以这张图为准" onRemove={() => onOriginal(null)} /> : <>
        <ImageDropzone label="选择底图" hint="或直接从 Photoshop 导入" onPick={onOriginal} />
        <PhotoshopImportButton role="original" onPick={onOriginal} />
      </>}
    </section>
    <section className="intake-requirement surface-row p-4 space-y-4">
      <h2 className="section-title">修图要求</h2>
      {renderKey('requirement')}
      {byKey('taskType') && <div className="flex flex-wrap gap-2" aria-label="任务快捷模板">
        {[['质感升级','质感升级'],['换背景','替换背景'],['置入物体','置入物体'],['局部修改','局部替换'],['自定义','']].map(([label,value]) =>
          <button key={label} type="button" className="template-chip" aria-pressed={(intake.taskType ?? '') === value}
            onClick={() => onIntake('taskType',value)}>{label}</button>)}
      </div>}
      {advanced.length > 0 && <details className="disclosure">
        <summary>精细调整 <span>{intake.taskType || '自动判断'}</span></summary>
        <div className="space-y-4 pt-3">{advanced.map(renderField)}</div>
      </details>}
    </section>
    {(byKey('constraints') || preserve) && <section className="intake-constraints surface-row p-4 space-y-3">
      <h2 className="section-title">约束 · 保持什么不变</h2>
      <div className="flex flex-wrap items-center gap-2">
        {preserve?.options && preserve.options.length > 0 && (
          <button type="button" className="template-chip chip-all"
            onClick={() => {
              // 全选：一次把所有「保持不变」写进约束框。
              // 复用 appendConstraint，已存在的项不会重复插入。
              const next = (preserve.options ?? []).reduce(
                (text, label) => appendConstraint(text, label),
                intake.constraints ?? '',
              );
              onIntake('constraints', next);
            }}>全选</button>
        )}
        {preserve?.options?.map(label => <button key={label} type="button" className="template-chip"
          onClick={() => onIntake('constraints',appendConstraint(intake.constraints ?? '',label))}>{label}</button>)}
      </div>
      {renderKey('constraints')}
    </section>}
    <section className="intake-references surface-row p-4 space-y-3">
      <h2 className="section-title">参考图 <span className="text-xs text-fg-muted">{references.length} 张 · 可选</span></h2>
      <RefPlanPanel references={references} busy={busy} onChange={onReferenceNote} onRemove={onRemoveReference} />
      <ImageDropzone compact multiple label="添加参考图" hint="每张图单独说明借用的内容" onPick={onAddReference} />
      <PhotoshopImportButton role="reference" onPick={onAddReference} />
    </section>
    <section className="intake-format surface-row p-4">
      <details className="disclosure"><summary>输出格式 <span>{intake.outputSize || '原图尺寸'}</span></summary>
        <div className="space-y-4 pt-3">{fields.filter(f => f.group === 'format').map(renderField)}</div>
      </details>
    </section>
    {supportsResearch && <details className="intake-research surface-row p-4 disclosure">
      <summary>资料与人设 <span>按需补充</span></summary>
      <div className="space-y-4 pt-3">
        {researchKeys.map(renderKey)}
        <ResearchPanel research={research} persona={persona} busy={busy} missing={missing} onLoad={onLoadResearch}
          onApply={onApplyResearch} onPersona={onLoadPersona} onAnswer={onAnswerChecklist} onCopy={onCopy} />
      </div>
    </details>}
    {directives.length > 0 && <details className="intake-rules disclosure text-xs text-fg-muted">
      <summary>已启用 {directives.length} 项专项规则</summary>
      {directives.map(d => <p key={d.label} className="py-2"><strong>{d.label}</strong>：{d.instruction}</p>)}
    </details>}
  </fieldset>;
}

function ImageCard({
  image,
  label,
  caption,
  onRemove,
}: {
  image: WizardImage;
  label: string;
  caption: string;
  onRemove: () => void;
}) {
  const outputMime = mimeOf(image.dataUrl);
  const converted =
    image.sourceMime !== undefined && image.sourceMime !== outputMime;
  const compressed =
    image.originalBytes !== undefined && image.originalBytes > image.bytes;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-line p-3 border-line">
      <img
        src={image.dataUrl}
        alt={label}
        className="h-16 w-16 shrink-0 rounded-lg bg-ink-750 object-cover"
      />
      <div className="min-w-0 space-y-1 text-xs text-fg-muted text-fg-muted">
        <p className="font-medium text-fg text-fg">
          {label}
          <span className="block truncate font-normal" title={image.name}>{image.name}</span>
        </p>
        <p className="truncate">{caption}</p>
        <p>
          {image.width} × {image.height} · {formatBytes(image.bytes)}
        </p>
        {image.captureScope && (
          <p className="text-violet-600 dark:text-violet-400">
            {image.captureScope === "selection"
              ? "已导入 Photoshop 选区"
              : "已导入 Photoshop 完整画布"}
          </p>
        )}
        {converted && (
          <p className="text-emerald-600 dark:text-emerald-400">
            格式已转换：{image.sourceMime || "未知类型"} →{" "}
            {outputMime.replace("image/", "").toUpperCase()}
          </p>
        )}
        {compressed && (
          <p className="text-emerald-600 dark:text-emerald-400">
            已压缩：{formatBytes(image.originalBytes ?? 0)} →{" "}
            {formatBytes(image.bytes)}
          </p>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 rounded-md border border-line px-2 py-1 hover:bg-ink-750 border-line-strong dark:hover:bg-ink-700"
        >
          移除
        </button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-ink-800 px-3 py-2 text-sm outline-none " +
  "focus:border-accent border-line-strong bg-ink-800";

const chipClass =
  "inline-block rounded-full border border-line px-3 py-1 text-xs text-fg-muted " +
  "transition-colors hover:border-line-strong " +
  "peer-checked:border-accent peer-checked:bg-accent peer-checked:text-ink-900 " +
  "peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400 " +
  "border-line-strong text-fg hover:border-line-strong " +
  "";

const miniBtn =
  "rounded-md border border-line px-2 py-0.5 text-xs hover:bg-ink-750 " +
  "border-line-strong dark:hover:bg-ink-700";
