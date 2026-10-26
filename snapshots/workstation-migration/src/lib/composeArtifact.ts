import type { RawArtifact } from './llm/schemas.ts'
import type { Artifact, WizardContext } from './wizardTypes.ts'
import { stripPlacementReferenceLabels, stripTrailingAdvice } from './promptClean.ts'
import { parseMulti } from './multiValue.ts'

/** Preserve the installed version's output format while moving it out of bundle patches. */
export function cleanComposedPrompt(prompt: string, ctx: WizardContext): string {
  const plain = stripTrailingAdvice(prompt.trim())
  const placementOnly = ctx.workflow.id === 'refine'
    && parseMulti(ctx.intake.taskType).includes('置入物体')
    && !String(ctx.intake.referencePolicy ?? '').includes('参考图参与')
  return (placementOnly ? stripPlacementReferenceLabels(plain) : plain)
    .replace(/\[cite:[^\]]*\]/giu, '').replace(/[ \t]{2,}/gu, ' ').trim()
}

export function composeStructuredArtifact(data: RawArtifact, ctx: WizardContext, fallbackChannel: string): Artifact {
  const clean = (text: string) => cleanComposedPrompt(text, ctx)
  const params = data.params?.map(p => p.trim()).filter(Boolean)
  let prompt = data.prompt
  if (ctx.workflow.outputContract === 'mj-prompt-en' && data.sections?.length) {
    const sections = data.sections.map(s => ({ key: s.key.trim(), body: clean(s.body) }))
      .filter(s => s.key && s.body)
    const positive = sections.find(s => /正面|positive/i.test(s.key)) ?? sections[0]
    if (positive) {
      const negative = sections.filter(s => /负面|negative/i.test(s.key)).map(s => s.body).join(', ')
      const parameterLine = params?.join(' ') ?? ''
      const fullLine = [positive.body, parameterLine, negative ? `--no ${negative}` : ''].filter(Boolean).join(' ')
      prompt = [
        { key: '完整一行（可直接粘贴）', body: fullLine },
        ...sections,
        ...(parameterLine ? [{ key: '参数', body: parameterLine }] : []),
      ].map(s => `【${s.key}】\n${s.body}`).join('\n\n')
    }
  }
  return {
    prompt: clean(prompt),
    channel: data.channel?.trim() || fallbackChannel,
    params: params?.length ? params : undefined,
    checklist: data.checklist?.map(c => c.trim()).filter(Boolean),
  }
}
