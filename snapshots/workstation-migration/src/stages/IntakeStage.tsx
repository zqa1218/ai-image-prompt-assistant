import ImageDropzone from '../components/ImageDropzone.tsx'
import PhotoshopImportButton from '../components/PhotoshopImportButton.tsx'
import ArchivePanel from '../components/ArchivePanel.tsx'
import type { ResolvedDirective } from '../lib/directives.ts'
import { visibleFields } from '../lib/fields.ts'
import { formatBytes, mimeOf } from '../lib/image.ts'
import { isAllSelected, parseMulti, setMultiAll, toggleMulti } from '../lib/multiValue.ts'
import { imageLabel, type ImageRef, type WizardImage } from '../lib/wizardTypes.ts'
import type { WorkflowStage } from '../workflows/types.ts'

type Props = {
  stage: WorkflowStage
  intake: Record<string, string>
  original: WizardImage | null
  references: WizardImage[]
  directives: ResolvedDirective[]
  onIntake: (key: string, value: string) => void
  onOriginal: (image: ImageRef | null) => void
  onAddReference: (image: ImageRef) => void
  onRemoveReference: (index: number) => void
  onReferenceNote: (index: number, note: string) => void
}

export default function IntakeStage({
  stage,
  intake,
  original,
  references,
  directives,
  onIntake,
  onOriginal,
  onAddReference,
  onRemoveReference,
  onReferenceNote,
}: Props) {
  const fields = visibleFields(stage, intake)

  return (
    <div className="space-y-6">
      <ArchivePanel />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          原图
          <span className="ml-2 text-xs font-normal text-red-500">必填</span>
        </h2>
        {original ? (
          <ImageCard
            image={original}
            label="原图"
            caption="统一称为 REFERENCE_0"
            onRemove={() => onOriginal(null)}
          />
        ) : (
          <div className="space-y-2">
            <ImageDropzone
              label="点击选择原图"
              hint="支持 JPEG / PNG / WebP / GIF；其它格式会自动转成 JPEG 后上传，全程在本机处理"
              onPick={onOriginal}
            />
            <PhotoshopImportButton role="original" onPick={onOriginal} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          参考图
          <span className="ml-2 text-xs font-normal text-neutral-400">
            可选 · 可作为人设、发型、服装、物体、材质、特效、背景或光线参考
          </span>
        </h2>
        {references.length > 0 && (
          <div className="space-y-2">
            {references.map((reference, index) => (
              <div key={`${reference.name}-${index}`} className="space-y-2">
              <ImageCard
                image={reference}
                label={imageLabel(reference, index + 1)}
                caption="只提供它承担的那部分信息，不当作第二张原图"
                onRemove={() => onRemoveReference(index)}
              />
              <label className="block text-sm">
                参考图{index + 1}的分工
                <input value={reference.note ?? ''} maxLength={2000} onChange={event => onReferenceNote(index, event.target.value)}
                  placeholder="例如：只借用电弧的形态与颜色，不借用人物和背景"
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
              </label>
              </div>
            ))}
          </div>
        )}
        <ImageDropzone
          compact
          multiple
          label={references.length > 0 ? '继续添加参考图' : '点击添加参考图（可多张）'}
          hint="按添加顺序编号为 REFERENCE_1、REFERENCE_2；具体职责在下方选择"
          onPick={onAddReference}
        />
        <PhotoshopImportButton role="reference" onPick={onAddReference} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">需求</h2>
        {fields.map((field) =>
          field.kind === 'multi' ? (
            <fieldset key={field.key} className="space-y-2">
              <legend className="flex w-full items-baseline gap-2 text-sm font-medium">
                {field.label}
                {field.required && <span className="text-xs text-red-500">必填</span>}
                <span className="text-xs font-normal text-neutral-400">可多选</span>
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
                            !isAllSelected(intake[field.key], field.options ?? []),
                          ),
                        )
                      }
                    >
                      {isAllSelected(intake[field.key], field.options ?? []) ? '取消全选' : '全选'}
                    </button>
                    {parseMulti(intake[field.key]).length > 0 && (
                      <button
                        type="button"
                        className={miniBtn}
                        onClick={() => onIntake(field.key, setMultiAll(intake[field.key], field.options ?? [], false))}
                      >
                        清空
                      </button>
                    )}
                  </span>
                )}
              </legend>
              <div className="flex flex-wrap gap-2">
                {field.options?.map((option) => {
                  const checked = parseMulti(intake[field.key]).includes(option)
                  return (
                    <label key={option} className="cursor-pointer">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={checked}
                        onChange={() =>
                          onIntake(field.key, toggleMulti(intake[field.key], option))
                        }
                      />
                      <span className={chipClass}>{option}</span>
                    </label>
                  )
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
                {field.required && <span className="text-xs text-red-500">必填</span>}
              </label>
              {field.kind === 'select' ? (
                <select
                  id={`intake-${field.key}`}
                  data-intake-field={field.key}
                  value={intake[field.key] ?? ''}
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
              ) : field.kind === 'textarea' ? (
                <textarea
                  id={`intake-${field.key}`}
                  data-intake-field={field.key}
                  rows={3}
                  value={intake[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => onIntake(field.key, e.target.value)}
                  className={inputClass + ' resize-y'}
                />
              ) : (
                <input
                  id={`intake-${field.key}`}
                  data-intake-field={field.key}
                  value={intake[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => onIntake(field.key, e.target.value)}
                  className={inputClass}
                />
              )}
            </div>
          ),
        )}
      </section>

      {directives.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            已启用的专项规则
            <span className="ml-2 text-xs font-normal text-neutral-400">
              按上面的选择自动追加，不会改动缓存前缀
            </span>
          </h2>
          <ul className="space-y-2">
            {directives.map((directive) => (
              <li
                key={directive.label}
                className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <p className="text-xs font-medium">{directive.label}</p>
                <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-neutral-500 dark:text-neutral-400">
                  {directive.instruction}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ImageCard({
  image,
  label,
  caption,
  onRemove,
}: {
  image: WizardImage
  label: string
  caption: string
  onRemove: () => void
}) {
  const outputMime = mimeOf(image.dataUrl)
  const converted = image.sourceMime !== undefined && image.sourceMime !== outputMime
  const compressed = image.originalBytes !== undefined && image.originalBytes > image.bytes

  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <img
        src={image.dataUrl}
        alt={label}
        className="h-24 w-24 shrink-0 rounded-lg bg-neutral-100 object-cover dark:bg-neutral-800"
      />
      <div className="min-w-0 space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        <p className="font-medium text-neutral-700 dark:text-neutral-300">
          {label}
          <span className="ml-2 font-normal">{image.name}</span>
        </p>
        <p className="truncate">{caption}</p>
        <p>
          {image.width} × {image.height} · {formatBytes(image.bytes)}
        </p>
        {image.captureScope && (
          <p className="text-violet-600 dark:text-violet-400">
            {image.captureScope === 'selection' ? '已导入 Photoshop 选区' : '已导入 Photoshop 完整画布'}
          </p>
        )}
        {converted && (
          <p className="text-emerald-600 dark:text-emerald-400">
            格式已转换：{image.sourceMime || '未知类型'} →{' '}
            {outputMime.replace('image/', '').toUpperCase()}
          </p>
        )}
        {compressed && (
          <p className="text-emerald-600 dark:text-emerald-400">
            已压缩：{formatBytes(image.originalBytes ?? 0)} → {formatBytes(image.bytes)}
          </p>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          移除
        </button>
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ' +
  'focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900'

const chipClass =
  'inline-block rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 ' +
  'transition-colors hover:border-neutral-400 ' +
  'peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white ' +
  'peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400 ' +
  'dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 ' +
  'dark:peer-checked:border-neutral-100 dark:peer-checked:bg-neutral-100 dark:peer-checked:text-neutral-900'

const miniBtn =
  'rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 ' +
  'dark:border-neutral-700 dark:hover:bg-neutral-800'
