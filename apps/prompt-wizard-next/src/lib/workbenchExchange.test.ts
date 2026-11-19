import { beforeEach, expect, it } from 'vitest'
import { createExchange, contextImages } from './workbenchExchange.ts'
import { useWizard, setProvider, MOCK_PROVIDER } from './wizardStore.ts'

beforeEach(() => { setProvider(MOCK_PROVIDER); useWizard.getState().reset() })
it('retains inherited asset IDs and roles; returns only to the explicitly selected revision', () => {
  const context = { schemaVersion: 'workbench-context/1' as const, snapshot: { taskId: 'task_a', revision: 3, mode: 'mj_web' as const, prompt: { text: 'source', intent: '' }, references: [{ assetId: 'style_a', role: 'style_reference' as const, width: 1, height: 1, bytes: 10 }] }, images: [{ assetId: 'style_a', dataUrl: 'data:image/png;base64,AA==' }] }
  const images = contextImages(context)
  useWizard.getState().applyArchive({ workflowId: 'recompose', intake: { requirement: 'test' }, ...images })
  useWizard.setState({ workbenchTarget: context.snapshot, records: { analyze: { status: 'ready', output: 'analysis' } } })
  const artifact = { prompt: 'finished', channel: 'MJ', params: ['--s 0'] }
  const result = createExchange(useWizard.getState(), artifact, 0, true)
  expect(result.target).toEqual({ taskId: 'task_a', revision: 3 })
  expect(result.context.analysis).toBe('analysis')
  expect(result.images[0]).toMatchObject({ assetId: 'style_a', role: 'style_reference' })
  expect(createExchange(useWizard.getState(), artifact, null, false).target).toBeNull()
  useWizard.getState().nextRound(true)
  expect(useWizard.getState().workbenchTarget).toBeNull()
})
it('new images keep a stable identity across retries and replacement gets a new identity', () => {
  useWizard.getState().start('refine')
  const image = { name: 'base', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, bytes: 1 }
  useWizard.getState().setOriginal(image)
  const artifact = { prompt: 'refined', channel: 'Banana' }
  const first = createExchange(useWizard.getState(), artifact, null, false)
  expect(createExchange(useWizard.getState(), artifact, null, false)).toEqual(first)
  expect(first.images[0].role).toBe('base')
  useWizard.getState().setOriginal(image)
  expect(createExchange(useWizard.getState(), artifact, null, false).images[0].assetId).not.toBe(first.images[0].assetId)
})
it('Photoshop images emit an exact target fingerprint and a separate true selection mask', () => {
  useWizard.getState().start('recompose')
  useWizard.getState().setOriginal({
    name: 'selection', dataUrl: 'data:image/jpeg;base64,AA==', width: 400, height: 300, bytes: 1,
    photoshopSessionId: 'session_direct_1', documentId: 27, documentName: '非零偏移.psd', canvasWidth: 1200, canvasHeight: 800,
    captureScope: 'selection', selectionBounds: { left: 200, top: 100, right: 1000, bottom: 700 },
    selectionMaskDataUrl: 'data:image/jpeg;base64,AQ==', note: '只修改选区内部',
  })
  const result = createExchange(useWizard.getState(), { prompt: 'result', channel: 'MJ' }, null, false)
  expect(result.images).toHaveLength(2)
  expect(result.images[0].photoshop).toMatchObject({ documentId: 27, placement: 'fit_selection', maskAssetId: result.images[1].assetId })
  expect(result.images[0].note).toBe('只修改选区内部')
  expect(result.images[1]).toMatchObject({ role: 'mask', dataUrl: 'data:image/jpeg;base64,AQ==' })
})
