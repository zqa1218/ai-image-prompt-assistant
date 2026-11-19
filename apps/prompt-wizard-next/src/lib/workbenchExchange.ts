import type { Artifact, WizardImage } from './wizardTypes.ts'
import type { WizardState } from './wizardStore.ts'

export type WorkbenchRole = 'base' | 'image_prompt' | 'style_reference' | 'edit_reference' | 'character_reference' | 'mask'
export type WorkbenchTarget = { taskId: string; revision: number; mode: 'mj_web' | 'banana_api' }
export type WorkbenchContext = {
  schemaVersion: 'workbench-context/1'
  snapshot: WorkbenchTarget & {
    prompt: { intent: string; text: string; exchange?: { images?: { assetId: string; note?: string }[] } }
    references: { assetId: string; role: WorkbenchRole; width: number; height: number; bytes: number }[]
    photoshopContext?: {
      sessionId: string; documentId: number; documentName: string; canvasWidth: number; canvasHeight: number;
      captureAssetId: string; captureScope: 'canvas' | 'selection'; selectionBounds: { left: number; top: number; right: number; bottom: number } | null;
      maskAssetId: string | null; placement: 'fit_canvas' | 'fit_selection' | 'new_document'
    } | null
  }
  images: { assetId: string; dataUrl: string }[]
}

export function contextImages(context: WorkbenchContext): { original: WizardImage | null; references: WizardImage[] } {
  const photoshop = context.snapshot.photoshopContext
  const imageNotes = new Map((context.snapshot.prompt.exchange?.images ?? []).map(image => [image.assetId, image.note]))
  const maskDataUrl = photoshop?.maskAssetId ? context.images.find(image => image.assetId === photoshop.maskAssetId)?.dataUrl ?? null : null
  const images = context.snapshot.references.filter(ref => ref.role !== 'mask').map(ref => ({
    name: ref.assetId, dataUrl: context.images.find(image => image.assetId === ref.assetId)!.dataUrl,
    width: ref.width, height: ref.height, bytes: ref.bytes,
    workbenchAssetId: ref.assetId, workbenchRole: ref.role,
    ...(imageNotes.get(ref.assetId) ? { note: imageNotes.get(ref.assetId) } : {}),
    ...(photoshop?.captureAssetId === ref.assetId ? {
      photoshopSessionId: photoshop.sessionId, documentId: photoshop.documentId, documentName: photoshop.documentName,
      canvasWidth: photoshop.canvasWidth, canvasHeight: photoshop.canvasHeight, captureScope: photoshop.captureScope,
      selectionBounds: photoshop.selectionBounds, selectionMaskDataUrl: maskDataUrl,
    } : {}),
    role: 'reference' as const,
  }))
  const base = images.find(image => image.workbenchRole === 'base') ?? images.find(image => image.workbenchRole !== 'mask')
  return { original: base ? { ...base, role: 'original' } : null, references: images.filter(image => image !== base) }
}

export function createExchange(state: WizardState, artifact: Artifact, selectedParameterIndex: number | null, returnToTask: boolean) {
  const images = [...(state.original ? [state.original] : []), ...state.references]
  const exchangeImages = images.flatMap((image, index) => {
    const assetId = image.workbenchAssetId ?? `wizard_image_${index}`
    const role = image.workbenchRole ?? (image.role === 'original' && state.workflowId === 'refine' ? 'base' : state.workflowId === 'refine' ? 'edit_reference' : 'image_prompt')
    const maskAssetId = image.selectionMaskDataUrl ? `${assetId}_selection_mask` : null
    const photoshop = image.photoshopSessionId && image.documentId && image.documentName && image.canvasWidth && image.canvasHeight
      ? {
          sessionId: image.photoshopSessionId, documentId: image.documentId, documentName: image.documentName,
          canvasWidth: image.canvasWidth, canvasHeight: image.canvasHeight, captureScope: image.captureScope ?? 'canvas',
          selectionBounds: image.selectionBounds ?? null, maskAssetId,
          placement: image.captureScope === 'selection' ? 'fit_selection' as const : 'fit_canvas' as const,
        }
      : undefined
    return [
      { assetId, role, dataUrl: image.dataUrl, ...(image.note ? { note: image.note } : {}), ...(photoshop ? { photoshop } : {}) },
      ...(image.selectionMaskDataUrl ? [{ assetId: maskAssetId!, role: 'mask' as const, dataUrl: image.selectionMaskDataUrl }] : []),
    ]
  })
  return {
    schemaVersion: 'prompt-wizard-exchange/1', workflowId: state.workflowId,
    artifact,
    context: {
      analysis: typeof state.records.analyze?.output === 'string' ? state.records.analyze.output : '',
      requirements: state.intake, notes: state.notes,
      direction: JSON.stringify({ options: state.options, selectedOptionId: state.selectedOptionId, referenceItems: state.referenceItems.filter(item => state.selectedReferenceItems.includes(item.id)) }),
    },
    target: returnToTask && state.workbenchTarget ? { taskId: state.workbenchTarget.taskId, revision: state.workbenchTarget.revision } : null,
    selectedParameterIndex,
    images: exchangeImages,
  }
}
