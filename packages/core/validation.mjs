import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const schema = JSON.parse(fs.readFileSync(new URL('../../contracts/job-package.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(JSON.parse(fs.readFileSync(new URL('../../contracts/prompt-wizard-exchange.schema.json', import.meta.url), 'utf8')));
const validate = ajv.compile(schema);

export class WorkbenchError extends Error {
  constructor(code, message) { super(message); this.name = 'WorkbenchError'; this.code = code; }
}
export function requireThat(condition, code, message) {
  if (!condition) throw new WorkbenchError(code, message);
}
export function validateInput(input) {
  requireThat(validate(input), 'INVALID_INPUT', ajv.errorsText(validate.errors, { separator: '; ' }));
  requireThat(input.prompt.text.length <= 32000 && input.prompt.intent.length <= 32000, 'INPUT_TOO_LONG', '提示词/需求不能超过 32000 字符');
  requireThat(input.references.length <= 32, 'TOO_MANY_ASSETS', '一个输入最多 32 张素材');
  requireThat(input.references.reduce((sum, ref) => sum + ref.bytes, 0) <= 128 * 1024 * 1024, 'ASSET_TOTAL_SIZE', '单个任务素材总量不能超过 128 MiB');
  const ids = new Set();
  for (const ref of input.references) {
    requireThat(!ids.has(ref.assetId), 'DUPLICATE_ASSET', `素材 ID 重复: ${ref.assetId}`);
    ids.add(ref.assetId);
  }
  requireThat(!input.confirmation || input.confirmation.revision === input.revision, 'CONFIRMATION_MISMATCH', '确认版本与输入版本不一致');
  const ps = input.photoshopContext;
  if (ps) {
    const capture = input.references.find(ref => ref.assetId === ps.captureAssetId);
    requireThat(capture && capture.source === 'photoshop', 'PS_CAPTURE_MISSING', 'PS 上下文必须指向来自 Photoshop 的素材');
    if (ps.maskAssetId) requireThat(input.references.some(ref => ref.assetId === ps.maskAssetId && ref.role === 'mask' && ref.source === 'photoshop'), 'PS_MASK_MISSING', '选区蒙版必须指向 Photoshop 读取的真实 selection mask 素材');
    if (ps.selectionBounds) {
      const { left, top, right, bottom } = ps.selectionBounds;
      requireThat(right > left && bottom > top && right <= ps.canvasWidth && bottom <= ps.canvasHeight, 'PS_BOUNDS_INVALID', '选区必须是画布内的有效矩形');
    }
  }
  return input;
}

export function validateReady(input) {
  validateInput(input);
  requireThat(input.prompt.text.trim(), 'PROMPT_EMPTY', '请填写最终提示词');
  if (input.mode === 'mj_web') {
    // Dynamic import would hide validation errors behind a Promise; keep this function synchronous.
    requireThat(input.references.filter(x => !x.analysisOnly).every(x => x.bytes <= 10 * 1024 * 1024), 'MJ_ASSET_TOO_LARGE', '官网参考图单图不能超过 10 MiB；请先在官网核对限制并准备素材');
  }
}
