import fs from 'node:fs';
import Ajv from 'ajv';
import { makeDraft } from '../core/draft.mjs';
import { requireThat, validateInput } from '../core/validation.mjs';
import { imageInfo, saveImage, verifyAsset } from '../storage/assets.mjs';
import { validateDocumentSnapshot } from './photoshop.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../../contracts/prompt-wizard-exchange.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const check = ajv.compile(schema);
export const EXCHANGE_LIMIT = 40 * 1024 * 1024;
const IMAGE_TOTAL = 28 * 1024 * 1024;

export function decodeExchangeImage(dataUrl) {
  requireThat(typeof dataUrl === 'string' && dataUrl.length <= 40000000, 'INVALID_IMAGE', '交换图片过大或格式错误');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  requireThat(match, 'INVALID_IMAGE', '交换图片仅接受内嵌 PNG、JPEG 或 WebP，不读取文件路径或远程网址');
  const data = Buffer.from(match[2], 'base64');
  requireThat(data.toString('base64') === match[2], 'INVALID_IMAGE', '图片 Base64 编码无效');
  const info = imageInfo(data);
  requireThat(info.mediaType === match[1], 'INVALID_IMAGE', '图片内容与声明类型不符');
  return { ...info, data };
}

// Only unambiguous, explicitly selected options become fields. Keep everything else visible.
export function mapParameterOption(option) {
  const fields = {}, pending = [], seen = new Set();
  const aliases = { v: 'modelVersion', version: 'modelVersion', ar: 'aspectRatio', aspect: 'aspectRatio', s: 'stylize', stylize: 'stylize', c: 'chaos', chaos: 'chaos', weird: 'weird', seed: 'seed', raw: 'raw' };
  const start = option.search(/--[a-zA-Z]/);
  const tokens = start < 0 ? [] : option.slice(start).split(/\s+(?=--[a-zA-Z])/);
  // Non-option labels are retained for review too.
  const prefix = option.split(/--[a-zA-Z]/)[0].trim();
  if (prefix) pending.push(prefix);
  for (const token of tokens) {
    const [, name, value = ''] = /^--([\w-]+)(?:\s+([^]*))?$/.exec(token.trim());
    const field = aliases[name], text = value.trim();
    let parsed;
    if (field === 'raw' && text === '') parsed = true;
    else if (field === 'modelVersion' && /^\d+(?:\.\d+)?$/.test(text)) parsed = text;
    else if (field === 'aspectRatio' && /^[1-9]\d*:[1-9]\d*$/.test(text)) parsed = text;
    else if (['stylize', 'chaos', 'weird', 'seed'].includes(field) && /^\d+$/.test(text) && Number.isSafeInteger(Number(text))) parsed = Number(text);
    if (!field || parsed === undefined || seen.has(field)) {
      pending.push(token.trim());
      if (field && seen.has(field)) { delete fields[field]; pending.push(`重复参数 ${field}，该字段未自动应用`); }
    } else fields[field] = parsed;
    if (field) seen.add(field);
  }
  if (!tokens.length && !prefix) pending.push(option);
  return { fields, pending };
}

export function validateExchange(exchange) {
  requireThat(check(exchange), 'INVALID_EXCHANGE', ajv.errorsText(check.errors));
  requireThat(exchange.selectedParameterIndex === null || exchange.selectedParameterIndex < (exchange.artifact.params?.length ?? 0), 'INVALID_PARAMETER_OPTION', '所选参数方案不存在');
  requireThat(Buffer.byteLength(JSON.stringify(exchange)) <= EXCHANGE_LIMIT, 'BODY_TOO_LARGE', '交换包不能超过 40 MiB');
  return exchange;
}

export function importExchange(store, exchange, mode) {
  validateExchange(exchange);
  const original = exchange.target ? store.revision(store.get(exchange.target.taskId), exchange.target.revision, true) : null;
  requireThat(!original || original.mode === mode, 'MODE_MISMATCH', '返回任务时通道必须一致；切换通道请新建草稿');
  const input = original ? structuredClone(original) : makeDraft('', mode);
  input.confirmation = null;
  input.prompt.text = exchange.artifact.prompt;
  input.prompt.source = 'prompt_wizard';
  input.prompt.workflowId = exchange.workflowId;
  input.prompt.exchange = { ...structuredClone(exchange), images: exchange.images.map(({ dataUrl, ...ref }) => ref) };
  if (!original) input.prompt.intent = Object.entries(exchange.context.requirements).map(([key, value]) => `${key}：${value}`).join('\n');
  const refs = new Map(), decoded = new Map(); let bytes = 0;
  for (const image of exchange.images) {
    const previous = refs.get(image.assetId);
    if (previous) {
      requireThat(previous.dataUrl === image.dataUrl && previous.role === image.role, 'DUPLICATE_ASSET', '同一素材 ID 对应不同内容或角色');
      continue;
    }
    refs.set(image.assetId, image);
    const decodedImage = decodeExchangeImage(image.dataUrl); bytes += decodedImage.bytes;
    requireThat(bytes <= IMAGE_TOTAL, 'ASSET_TOTAL_SIZE', '交换素材总量不能超过 28 MiB');
    decoded.set(image.assetId, decodedImage);
  }
  input.references = [...refs.values()].map(image => {
    const data = decoded.get(image.assetId);
    const inherited = original?.references.find(ref => ref.assetId === image.assetId);
    if (inherited) {
      verifyAsset(store.root, inherited);
      requireThat(inherited.sha256 === data.sha256 && inherited.role === image.role, 'ASSET_ID_CONFLICT', '继承素材已改变，请使用新的素材 ID 或重新导入任务上下文');
      return structuredClone(inherited);
    }
    const photoshopCapture = !original && [...refs.values()].find(item => item.photoshop)?.photoshop;
    const fromPhotoshop = !original && (image.photoshop || photoshopCapture?.maskAssetId === image.assetId);
    return { assetId: image.assetId, path: `assets/${data.sha256}.${data.extension}`, mediaType: data.mediaType, width: data.width, height: data.height, bytes: data.bytes, sha256: data.sha256, role: image.role, source: fromPhotoshop ? 'photoshop' : 'upload', analysisOnly: image.role === 'mask' || !fromPhotoshop };
  });
  const photoshopImages = [...refs.values()].filter(image => image.photoshop);
  requireThat(photoshopImages.length <= 1, 'PS_CONTEXT_CONFLICT', '一个交换包只能包含一个 Photoshop 来源上下文');
  if (!original && photoshopImages.length) {
    const capture = photoshopImages[0], ps = capture.photoshop;
    validateDocumentSnapshot({ ...ps, selectionBounds: ps.selectionBounds });
    requireThat((ps.captureScope === 'selection') === (ps.selectionBounds !== null), 'PS_BOUNDS_INVALID', 'Photoshop 选区范围与读取方式不一致');
    if (ps.maskAssetId) requireThat(refs.get(ps.maskAssetId)?.role === 'mask', 'PS_MASK_MISSING', 'Photoshop selection mask 素材缺失');
    input.photoshopContext = {
      sessionId: ps.sessionId, documentId: ps.documentId, documentName: ps.documentName,
      canvasWidth: ps.canvasWidth, canvasHeight: ps.canvasHeight, captureAssetId: capture.assetId,
      captureScope: ps.captureScope, selectionBounds: ps.selectionBounds, maskAssetId: ps.maskAssetId, placement: ps.placement,
    };
  }
  input.prompt.exchange.images = [...refs.values()].map(({ dataUrl, ...ref }) => ref);
  if (!original && mode === 'banana_api' && (exchange.workflowId === 'refine' || exchange.workflowId === 'refine-steps')) input.operation = 'edit';
  if (mode === 'mj_web') {
    input.settings.websiteChecklist = [...input.settings.websiteChecklist, ...(exchange.artifact.checklist ?? []).filter(Boolean)];
    if (exchange.selectedParameterIndex !== null) {
      const selected = exchange.artifact.params[exchange.selectedParameterIndex];
      const mapped = mapParameterOption(selected);
      Object.assign(input.settings, mapped.fields);
      input.settings.websiteChecklist.push(...mapped.pending.filter(Boolean).map(text => `所选方案待核对：${text}`));
    } else input.settings.websiteChecklist.push(...(exchange.artifact.params ?? []).filter(Boolean).map(text => `尚未选择参数方案：${text}`));
  }
  validateInput(input);
  // Validate the complete batch before persisting any images or task revisions.
  for (const data of decoded.values()) saveImage(store.root, data);
  return original ? store.revise(original.taskId, original.revision, input) : store.create(input);
}

export function exportWizardContext(store, taskId, revision) {
  const snapshot = structuredClone(store.revision(store.get(taskId), revision, true));
  requireThat(snapshot.references.reduce((sum, ref) => sum + ref.bytes, 0) <= IMAGE_TOTAL, 'ASSET_TOTAL_SIZE', '任务素材超过 28 MiB，请为提示词分析建立较小的任务');
  const images = snapshot.references.map(ref => {
    const data = verifyAsset(store.root, ref);
    return { assetId: ref.assetId, dataUrl: `data:${ref.mediaType};base64,${data.data.toString('base64')}` };
  });
  return { schemaVersion: 'workbench-context/1', snapshot, images };
}

export function validateWizardContext(context) {
  requireThat(context?.schemaVersion === 'workbench-context/1' && Array.isArray(context.images), 'INVALID_CONTEXT', '请选择工作台导出的提示词上下文 JSON');
  const snapshot = validateInput(context.snapshot);
  requireThat(context.images.length === snapshot.references.length, 'INVALID_CONTEXT', '上下文素材数量不一致');
  requireThat(Buffer.byteLength(JSON.stringify(context)) <= EXCHANGE_LIMIT, 'BODY_TOO_LARGE', '上下文不能超过 40 MiB');
  const seen = new Set(); let bytes = 0;
  const images = context.images.map(image => {
    const ref = snapshot.references.find(ref => ref.assetId === image.assetId);
    requireThat(ref && !seen.has(image.assetId), 'INVALID_CONTEXT', '上下文素材 ID 缺失或重复'); seen.add(image.assetId);
    const data = decodeExchangeImage(image.dataUrl); bytes += data.bytes;
    for (const field of ['sha256', 'mediaType', 'width', 'height', 'bytes']) requireThat(data[field] === ref[field], 'ASSET_MISMATCH', `上下文素材 ${field} 校验失败`);
    return { assetId: image.assetId, dataUrl: image.dataUrl };
  });
  requireThat(bytes <= IMAGE_TOTAL, 'ASSET_TOTAL_SIZE', '上下文素材总量不能超过 28 MiB');
  return { schemaVersion: 'workbench-context/1', snapshot, images };
}
