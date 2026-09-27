import { z } from 'zod'
import refineRaw from './refine.workflow.json'
import recomposeRaw from './recompose.workflow.json'
import type { Workflow } from './types.ts'

const thinkingSchema = z.union([
  z.object({ mode: z.literal('disabled') }),
  z.object({ mode: z.literal('enabled'), effort: z.enum(['low', 'high', 'max']) }),
])

const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['text', 'textarea', 'select', 'multi']),
  required: z.boolean(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  showWhen: z
    .object({ field: z.string().min(1), includes: z.string().min(1) })
    .optional(),
})

const directiveSchema = z.object({
  when: z.object({ field: z.string().min(1), includes: z.string().min(1) }),
  instruction: z.string().min(1),
  label: z.string().min(1),
})

const stageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intent: z.string().min(1),
  mode: z.enum(['form', 'auto', 'choice', 'hybrid', 'free']),
  thinking: thinkingSchema,
  fields: z.array(fieldSchema).optional(),
  minOptions: z.number().int().positive().optional(),
  maxOptions: z.number().int().positive().optional(),
  outputContract: z.enum(['four-section-cn', 'mj-prompt-en']).optional(),
})

const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  outputContract: z.enum(['four-section-cn', 'mj-prompt-en']),
  sharedAssets: z.array(z.string().min(1)),
  assets: z.array(z.string().min(1)),
  directives: z.array(directiveSchema).optional(),
  stages: z.array(stageSchema).min(1),
})

function parseWorkflow(raw: unknown, label: string): Workflow {
  const result = workflowSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`${label} 定义不合法：${result.error.message}`)
  }
  return result.data as Workflow
}

export const REFINE = parseWorkflow(refineRaw, 'refine.workflow.json')
export const RECOMPOSE = parseWorkflow(recomposeRaw, 'recompose.workflow.json')
export const WORKFLOWS: Workflow[] = [REFINE, RECOMPOSE]

export function getWorkflow(id: string): Workflow {
  const found = WORKFLOWS.find((w) => w.id === id)
  if (!found) throw new Error(`未知工作流：${id}`)
  return found
}
