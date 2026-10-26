import { useState } from 'react'
import { downloadText, safeFilename } from '../lib/download.ts'
import { parseSections, toMarkdown } from '../lib/promptSections.ts'
import type { Artifact } from '../lib/wizardTypes.ts'

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
    } catch {
      setCopiedKey('__fail')
    }
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return { copiedKey, copy }
}

export default function PromptOutput({
  artifact,
  exportName = '提示词',
}: {
  artifact: Artifact
  exportName?: string
}) {
  const { copiedKey, copy } = useCopy()
  const sections = parseSections(artifact.prompt)

  function exportMarkdown() {
    const lines = [
      `# ${exportName}`,
      '',
      sections ? toMarkdown(sections) : artifact.prompt,
      '',
      '## 交付方式',
      '',
      artifact.channel,
    ]
    if (artifact.params?.length) {
      lines.push('', '## 参数', '', ...artifact.params.map((p) => `- \`${p}\``))
    }
    if (artifact.checklist?.length) {
      lines.push('', '## 提交前检查', '', ...artifact.checklist.map((c) => `- [ ] ${c}`))
    }
    downloadText(safeFilename(exportName, '.md'), lines.join('\n'))
  }

  function exportJson() {
    downloadText(
      safeFilename(exportName, '.json'),
      JSON.stringify({ ...artifact, sections: sections ?? undefined }, null, 2),
      'application/json',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          最终提示词
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void copy(artifact.prompt, 'all')}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {copiedKey === 'all' ? '已复制' : copiedKey === '__fail' ? '复制失败' : '复制全文'}
          </button>
          <button type="button" onClick={exportMarkdown} className={ghostBtn}>
            导出 .md
          </button>
          <button type="button" onClick={exportJson} className={ghostBtn}>
            导出 .json
          </button>
        </div>
      </div>

      {sections ? (
        <div className="space-y-2">
          {sections.map((section, index) => (
            <div
              key={`${section.key}-${index}`}
              className="rounded-xl border border-neutral-200 dark:border-neutral-800"
            >
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
                <span className="text-xs font-semibold">{section.key}</span>
                <button
                  type="button"
                  onClick={() => void copy(section.body, section.key)}
                  className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  {copiedKey === section.key ? '已复制' : '复制这段'}
                </button>
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap">
                {section.body}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <pre className="overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
            {artifact.prompt}
          </pre>
        </div>
      )}

      <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        {artifact.channel}
      </p>

      {artifact.params && artifact.params.length > 0 && (
        <Section title="参数">
          <ul className="space-y-1">
            {artifact.params.map((p) => (
              <li key={p} className="text-xs">
                <code className="font-mono">{p}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {artifact.checklist && artifact.checklist.length > 0 && (
        <Section title="提交前 QA 清单">
          <ul className="space-y-1 text-xs">
            {artifact.checklist.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-neutral-400">□</span>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

const ghostBtn =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 ' +
  'dark:border-neutral-700 dark:hover:bg-neutral-800'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <h3 className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">{title}</h3>
      {children}
    </div>
  )
}
