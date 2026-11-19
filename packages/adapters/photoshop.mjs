import { WorkbenchError, requireThat } from '../core/validation.mjs';

const ID = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_EDGE = 100_000;
const PLACEMENTS = new Set(['fit_canvas', 'fit_selection', 'new_document']);

function integer(value, field, minimum = 0, maximum = MAX_EDGE) {
  requireThat(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'PS_INVALID_DOCUMENT', `${field} 无效`);
  return value;
}

function sameBounds(left, right) {
  if (left === null || right === null) return left === right;
  return ['left', 'top', 'right', 'bottom'].every(key => left[key] === right[key]);
}

export function validateBounds(bounds, canvasWidth, canvasHeight, { nullable = true } = {}) {
  if (bounds === null && nullable) return null;
  requireThat(bounds && typeof bounds === 'object' && !Array.isArray(bounds), 'PS_BOUNDS_INVALID', 'Photoshop 选区边界无效');
  const left = integer(bounds.left, 'selection.left');
  const top = integer(bounds.top, 'selection.top');
  const right = integer(bounds.right, 'selection.right', 1);
  const bottom = integer(bounds.bottom, 'selection.bottom', 1);
  requireThat(right > left && bottom > top && right <= canvasWidth && bottom <= canvasHeight, 'PS_BOUNDS_INVALID', 'Photoshop 选区必须位于画布内');
  return { left, top, right, bottom };
}

export function validateDocumentSnapshot(value) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'PS_INVALID_DOCUMENT', 'Photoshop 文档信息无效');
  requireThat(typeof value.sessionId === 'string' && ID.test(value.sessionId), 'PS_INVALID_SESSION', 'Photoshop 会话标识无效');
  const documentId = integer(value.documentId, 'documentId', 1, Number.MAX_SAFE_INTEGER);
  requireThat(typeof value.documentName === 'string' && value.documentName.trim().length > 0 && value.documentName.length <= 255, 'PS_INVALID_DOCUMENT', 'Photoshop 文档名称无效');
  const canvasWidth = integer(value.canvasWidth, 'canvasWidth', 1);
  const canvasHeight = integer(value.canvasHeight, 'canvasHeight', 1);
  return {
    sessionId: value.sessionId,
    documentId,
    documentName: value.documentName,
    canvasWidth,
    canvasHeight,
    selectionBounds: validateBounds(value.selectionBounds ?? null, canvasWidth, canvasHeight),
  };
}

export function analysisCapturePlan(document, { scope = 'auto', maxSize = 1568 } = {}) {
  const snapshot = validateDocumentSnapshot(document);
  requireThat(['auto', 'canvas', 'selection'].includes(scope), 'PS_CAPTURE_SCOPE', 'Photoshop 读取范围无效');
  requireThat(Number.isSafeInteger(maxSize) && maxSize >= 64 && maxSize <= 8192, 'PS_CAPTURE_SIZE', '分析图最长边必须为 64–8192 像素');
  const useSelection = scope === 'selection' || (scope === 'auto' && snapshot.selectionBounds !== null);
  requireThat(!useSelection || snapshot.selectionBounds, 'PS_SELECTION_REQUIRED', '当前文档没有可读取的选区');
  const sourceBounds = useSelection
    ? snapshot.selectionBounds
    : { left: 0, top: 0, right: snapshot.canvasWidth, bottom: snapshot.canvasHeight };
  const sourceWidth = sourceBounds.right - sourceBounds.left;
  const sourceHeight = sourceBounds.bottom - sourceBounds.top;
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const analysisWidth = Math.max(1, Math.round(sourceWidth * scale));
  const analysisHeight = Math.max(1, Math.round(sourceHeight * scale));
  return {
    captureScope: useSelection ? 'selection' : 'canvas',
    sourceBounds,
    sourceWidth,
    sourceHeight,
    analysisWidth,
    analysisHeight,
    canvasToAnalysis: {
      offsetX: sourceBounds.left,
      offsetY: sourceBounds.top,
      scaleX: analysisWidth / sourceWidth,
      scaleY: analysisHeight / sourceHeight,
    },
  };
}

export function analysisPointToCanvas(plan, point) {
  requireThat(plan?.canvasToAnalysis && Number.isFinite(point?.x) && Number.isFinite(point?.y), 'PS_COORDINATE_INVALID', '分析图坐标无效');
  const { offsetX, offsetY, scaleX, scaleY } = plan.canvasToAnalysis;
  requireThat(scaleX > 0 && scaleY > 0 && point.x >= 0 && point.y >= 0 && point.x <= plan.analysisWidth && point.y <= plan.analysisHeight, 'PS_COORDINATE_INVALID', '分析图坐标超出范围');
  return { x: offsetX + point.x / scaleX, y: offsetY + point.y / scaleY };
}

export function assertPlacementTarget(expectedContext, actualDocument) {
  const actual = validateDocumentSnapshot(actualDocument);
  requireThat(expectedContext && typeof expectedContext === 'object', 'PS_CONTEXT_REQUIRED', '任务没有 Photoshop 来源上下文');
  requireThat(expectedContext.sessionId === actual.sessionId, 'PS_SESSION_CHANGED', 'Photoshop 已重新启动或插件已重连，请重新选择目标文档');
  requireThat(expectedContext.documentId === actual.documentId, 'PS_DOCUMENT_CHANGED', '原 Photoshop 文档已关闭或目标已改变');
  requireThat(expectedContext.documentName === actual.documentName, 'PS_DOCUMENT_RENAMED', 'Photoshop 文档名称已变化，请重新确认目标');
  requireThat(expectedContext.canvasWidth === actual.canvasWidth && expectedContext.canvasHeight === actual.canvasHeight, 'PS_CANVAS_CHANGED', 'Photoshop 画布尺寸已变化，请重新读取后再回传');
  if (expectedContext.placement === 'fit_selection') {
    const expectedBounds = validateBounds(expectedContext.selectionBounds, actual.canvasWidth, actual.canvasHeight, { nullable: false });
    requireThat(sameBounds(expectedBounds, actual.selectionBounds), 'PS_SELECTION_CHANGED', 'Photoshop 选区已变化，请恢复原选区或重新读取');
  }
  return actual;
}

export function placementPlan({ sourceWidth, sourceHeight, placement, context }) {
  integer(sourceWidth, 'sourceWidth', 1);
  integer(sourceHeight, 'sourceHeight', 1);
  requireThat(PLACEMENTS.has(placement), 'PS_PLACEMENT_INVALID', 'Photoshop 回传方式无效');
  if (placement === 'new_document') {
    return { placement, left: 0, top: 0, width: sourceWidth, height: sourceHeight, scale: 1, requiresTarget: false };
  }
  requireThat(context && typeof context === 'object', 'PS_CONTEXT_REQUIRED', '回传原文档需要 Photoshop 来源上下文');
  const canvasWidth = integer(context.canvasWidth, 'canvasWidth', 1);
  const canvasHeight = integer(context.canvasHeight, 'canvasHeight', 1);
  const target = placement === 'fit_selection'
    ? validateBounds(context.selectionBounds, canvasWidth, canvasHeight, { nullable: false })
    : { left: 0, top: 0, right: canvasWidth, bottom: canvasHeight };
  const targetWidth = target.right - target.left;
  const targetHeight = target.bottom - target.top;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    placement,
    left: target.left + (targetWidth - width) / 2,
    top: target.top + (targetHeight - height) / 2,
    width,
    height,
    scale,
    requiresTarget: true,
  };
}

export function validatePlaceRequest(value) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'PS_PLACE_INVALID', 'Photoshop 回传请求无效');
  requireThat(typeof value.requestId === 'string' && ID.test(value.requestId), 'PS_REQUEST_ID', 'Photoshop 请求标识无效');
  requireThat(PLACEMENTS.has(value.placement), 'PS_PLACEMENT_INVALID', 'Photoshop 回传方式无效');
  requireThat(typeof value.layerName === 'string' && value.layerName.trim().length > 0 && value.layerName.length <= 255, 'PS_LAYER_NAME', 'Photoshop 图层名称无效');
  requireThat(typeof value.dataUrl === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl) && value.dataUrl.length <= 42_000_000, 'PS_IMAGE_INVALID', '回传图片必须是 30 MiB 以内的 PNG、JPEG 或 WebP');
  const plan = placementPlan({ sourceWidth: value.sourceWidth, sourceHeight: value.sourceHeight, placement: value.placement, context: value.context });
  if (plan.requiresTarget) validateDocumentSnapshot(value.context);
  return { ...value, plan };
}

export function photoshopError(error, fallback = 'Photoshop 操作失败') {
  return error instanceof WorkbenchError ? error : new WorkbenchError('PS_OPERATION_FAILED', error instanceof Error ? error.message : fallback);
}
