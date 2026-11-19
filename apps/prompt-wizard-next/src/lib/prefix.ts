import type { Workflow } from '../workflows/types.ts'
import type { AssetMap } from '../workflows/assets.ts'

/**
 * 全局指令是缓存前缀的第一段，跨工作流、跨阶段逐字不变。
 * 改动这里等于让所有历史缓存失效，请谨慎。
 */
export const GLOBAL_INSTRUCTIONS = `你是「提示词向导」的提示词工程引擎。你的职责是把用户的图片与修图 / 生图需求，
编译成可以直接执行的提示词。

通用纪律：
- 只写可观察、可执行的描述，不用「高级」「氛围感」这类形容词代替技术描述
- 不编造画面中看不到的信息；不确定的内容标注「疑似」
- 不复述你的推理过程，不输出与要求无关的解释
- 需要用户做选择时，给出 2~3 个差异化选项，每个写清代价与风险，并明确标出推荐项
- 用用户使用的语言作答（默认中文；Midjourney 提示词主体用英文）

以下为本次工作流固定加载的参考资料。它们按编号顺序生效，后续步骤直接引用其中的条目名称。
`

/** 统一换行符 —— Windows 下检出的 CRLF 会让缓存前缀与 LF 版本不一致。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * 前缀里资产的顺序：共享资产在前、专属资产在后。
 * 这样两条工作流共享一段可命中的缓存前缀，从共享段之后才分叉。
 */
export function orderedAssetIds(workflow: Workflow): string[] {
  return [...workflow.sharedAssets, ...workflow.assets]
}

/**
 * 构建缓存前缀。注意这个函数**只依赖工作流与资产**，不接受阶段参数——
 * 前缀一旦随阶段变化，缓存就会全部落空。
 */
export function buildPrefix(workflow: Workflow, assets: AssetMap): string {
  const parts: string[] = [normalizeNewlines(GLOBAL_INSTRUCTIONS).trimEnd()]

  for (const id of orderedAssetIds(workflow)) {
    const body = assets[id]
    if (body === undefined) {
      throw new Error(`工作流 ${workflow.id} 缺少资产：${id}`)
    }
    parts.push(`<!-- asset: ${id} -->\n${normalizeNewlines(body).trimEnd()}`)
  }

  return `${parts.join('\n\n')}\n`
}

/** SHA-256，用于验证前缀在改动前后是否一致。 */
export async function hashPrefix(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
