import { randomUUID } from 'node:crypto';
import { validateInput } from './validation.mjs';

export function makeDraft(text = '', mode = 'mj_web') {
  return validateInput({
    schemaVersion: '0.1.0', taskId: randomUUID(), revision: 1, createdAt: new Date().toISOString(),
    mode, operation: 'create', prompt: { intent: '', text, source: 'manual', workflowId: null },
    references: [], confirmation: null, photoshopContext: null,
    settings: mode === 'mj_web'
      ? { modelVersion: null, aspectRatio: null, raw: null, stylize: null, chaos: null, weird: null, seed: null, speed: null, resolution: null, extraParameters: '', websiteChecklist: [] }
      : { providerId: null, modelId: null, aspectRatio: null, resolution: null },
  });
}
