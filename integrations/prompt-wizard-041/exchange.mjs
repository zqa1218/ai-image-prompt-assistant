// The 0.4.1 runtime state is read at the output component, never from clipboard/DOM text.
export function recommendedMode(state) {
  return state.workflowId === 'recompose' ? 'mj_web' : 'banana_api';
}

export function isNewCompletedPrompt(current, previous, enabled) {
  return Boolean(enabled && !current.busy && current.artifact && current.artifact !== previous.artifact && current.promptVersion > previous.promptVersion);
}

export function createInstalledExchange(state, artifact, selectedParameterIndex = null) {
  if (state.busy) throw new Error('提示词仍在生成，请等待完成');
  if (!artifact?.prompt?.trim() || state.artifact !== artifact) throw new Error('提示词已变化，请使用当前生成结果');
  const images = [...(state.original ? [state.original] : []), ...(state.references ?? [])];
  const refine = state.workflowId !== 'recompose';
  return {
    schemaVersion: 'prompt-wizard-exchange/1', workflowId: state.workflowId,
    artifact: { prompt: artifact.prompt, channel: artifact.channel ?? '',
      ...(artifact.params ? { params: artifact.params } : {}),
      ...(artifact.checklist ? { checklist: artifact.checklist } : {}) },
    context: {
      analysis: typeof state.records?.analyze?.output === 'string' ? state.records.analyze.output : '',
      requirements: state.intake ?? {}, notes: state.notes ?? [],
      direction: JSON.stringify({ options: state.options ?? [], selectedOptionId: state.selectedOptionId ?? null,
        referenceItems: (state.referenceItems ?? []).filter(item => state.selectedReferenceItems?.includes(item.id)) }),
    },
    target: null, selectedParameterIndex,
    images: images.map((image, index) => ({
      assetId: `wizard_image_${index}`, role: refine ? (index === 0 && state.original ? 'base' : 'edit_reference') : 'image_prompt',
      dataUrl: image.dataUrl,
      note: [image.name, image.note, image.documentName ? `Photoshop 来源：${image.documentName}；原版未提供可验证的文档会话，仅作为分析图导入。` : ''].filter(Boolean).join('\n'),
    })),
  };
}
