import ImageDropzone from '../components/ImageDropzone.tsx'
import type { ResolvedDirective } from '../lib/directives.ts'
import { visibleFields } from '../lib/fields.ts'
import { formatBytes, mimeOf } from '../lib/image.ts'
import { parseMulti, toggleMulti } from '../lib/multiValue.ts'
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
}: Props) {
  const fields = visibleFields(stage, intake)

  return (
    <div className="space-y-6">
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
          <ImageDropzone
            label="点击选择原图"
            hint="支持 JPEG / PNG / WebP / GIF；其它格式会自动转成 JPEG 后上传，全程在本机处理"
            onPick={onOriginal}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          参考图
          <span className="ml-2 text-xs font-normal text-neutral-400">
            可选 · 需要把参考图里的物体置入原图时使用
          </span>
        </h2>
        {references.length > 0 && (
          <div className="space-y-2">
            {references.map((reference, index) => (
              <ImageCard
                key={`${reference.name}-${index}`}
                image={reference}
                label={imageLabel(reference, index + 1)}
                caption="只提供它承担的那部分信息，不当作第二张原图"
                onRemove={() => onRemoveReference(index)}
              />
            ))}
          </div>
        )}
        <ImageDropzone
          compact
          multiple
          label={references.length > 0 ? '继续添加参考图' : '点击添加参考图（可多张）'}
          hint="按添加顺序编号为「参考图1」「参考图2」"
          onPick={onAddReference}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">需求</h2>
        {fields.map((field) =>
          field.kind === 'multi' ? (
            <fieldset key={field.key} className="space-y-2">
              <legend className="flex items-baseline gap-2 text-sm font-medium">
                {field.label}
                {field.required && <span className="text-xs text-red-500">必填</span>}
                <span className="text-xs font-normal text-neutral-400">可多选</span>
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
            <label key={field.key} className="block space-y-1.5">
              <span className="flex items-baseline gap-2 text-sm font-medium">
                {field.label}
                {field.required && <span className="text-xs text-red-500">必填</span>}
              </span>
              {field.kind === 'select' ? (
                <select
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
                  rows={3}
                  value={intake[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => onIntake(field.key, e.target.value)}
                  className={inputClass + ' resize-y'}
                />
              ) : (
                <input
                  value={intake[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => onIntake(field.key, e.target.value)}
                  className={inputClass}
                />
              )}
            </label>
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
