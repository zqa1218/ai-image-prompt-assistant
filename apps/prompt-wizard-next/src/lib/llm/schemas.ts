import { z } from 'zod'

/**
 * 模型输出可能省略可选字段，这里刻意放宽：
 * 宁可接受一个少了 channel 的选项，也不要因为字段缺失就走降级。
 */
const rawDirectionSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  change: z.string().min(1),
  outcome: z.string().min(1),
  risk: z.string().min(1),
  channel: z.string().optional(),
  recommended: z.boolean().optional(),
})

export const directionsSchema = z.object({
  // 上限放宽到 6：模型多给一条不该让整批结果降级成一张原始文本卡
  options: z.array(rawDirectionSchema).min(2).max(6),
})

export type RawDirections = z.infer<typeof directionsSchema>

export const artifactSchema = z.object({
  prompt: z.string().min(1),
  channel: z.string().optional(),
  params: z.array(z.string()).optional(),
  checklist: z.array(z.string()).optional(),
})

export type RawArtifact = z.infer<typeof artifactSchema>

/** 类别刻意收成字符串再归一化：模型偶尔会用近义词，不该因此整批降级。 */
export const referenceItemsSchema = z.object({
  items: z
    .array(
      z.object({
        category: z.string().min(1),
        label: z.string().min(1),
        description: z.string().min(1),
        source: z.string().min(1),
      }),
    )
    .min(1)
    .max(40),
})

export type RawReferenceItems = z.infer<typeof referenceItemsSchema>
