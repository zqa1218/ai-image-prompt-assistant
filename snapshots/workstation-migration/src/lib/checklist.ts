import { z } from 'zod'
import { extractJson } from './llm/client.ts'

const option = z.union([z.string(), z.object({ label: z.string(), note: z.string().optional() })])
const item = z.object({ q: z.string(), why: z.string().optional(), options: z.array(option), recommended: z.number().int().optional() })
export type ChecklistItem = { q: string; why: string; options: { label: string; note: string }[]; recommended: number }
const clean = (s: string) => s.replace(/\[cite:[^\]]*\]/giu, '').trim()

export function parseChecklist(text: string): ChecklistItem[] {
  const parsed = z.object({ items: z.array(z.unknown()) }).safeParse(extractJson(text))
  if (!parsed.success) throw new Error('待定项格式不正确，请重新抓取或手动补充。')
  return parsed.data.items.flatMap(raw => {
    const result = item.safeParse(raw)
    if (!result.success) return []
    const value = result.data
    const options = value.options.map(o => typeof o === 'string' ? { label: clean(o), note: '' } : { label: clean(o.label), note: clean(o.note ?? '') }).filter(o => o.label).slice(0, 4)
    if (!clean(value.q) || options.length < 2) return []
    const recommended = value.recommended ?? 0
    return [{ q: clean(value.q), why: clean(value.why ?? ''), options, recommended: recommended >= 0 && recommended < options.length ? recommended : 0 }]
  }).slice(0, 5)
}

export function checklistSummary(items: ChecklistItem[], choices: Record<number, number>): string {
  const lines = items.flatMap((q, index) => {
    const selected = Number.isInteger(choices[index]) ? q.options[choices[index]] : undefined
    return selected ? [`${q.q} → ${selected.label}${selected.note ? `（${selected.note}）` : ''}`] : []
  })
  return lines.length ? `待定项确认：${lines.join('；')}` : ''
}
