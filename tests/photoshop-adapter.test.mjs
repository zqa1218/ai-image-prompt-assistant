import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisCapturePlan,
  analysisPointToCanvas,
  assertPlacementTarget,
  placementPlan,
  validatePlaceRequest,
} from '../packages/adapters/photoshop.mjs';

const document = (overrides = {}) => ({
  sessionId: 'session_1234', documentId: 17, documentName: '测试.psd', canvasWidth: 1200, canvasHeight: 800,
  selectionBounds: { left: 200, top: 100, right: 1000, bottom: 700 }, ...overrides,
});

test('analysis capture keeps crop offset and reversible nonzero coordinate mapping', () => {
  const plan = analysisCapturePlan(document(), { scope: 'selection', maxSize: 400 });
  assert.deepEqual(plan.sourceBounds, { left: 200, top: 100, right: 1000, bottom: 700 });
  assert.equal(plan.analysisWidth, 400);
  assert.equal(plan.analysisHeight, 300);
  assert.deepEqual(analysisPointToCanvas(plan, { x: 200, y: 150 }), { x: 600, y: 400 });
});

test('fit canvas and fit selection preserve aspect ratio and center the result', () => {
  assert.deepEqual(placementPlan({ sourceWidth: 1000, sourceHeight: 1000, placement: 'fit_canvas', context: document() }), {
    placement: 'fit_canvas', left: 200, top: 0, width: 800, height: 800, scale: 0.8, requiresTarget: true,
  });
  assert.deepEqual(placementPlan({ sourceWidth: 1600, sourceHeight: 400, placement: 'fit_selection', context: document() }), {
    placement: 'fit_selection', left: 200, top: 300, width: 800, height: 200, scale: 0.5, requiresTarget: true,
  });
});

test('placement rejects a restarted session, changed document, canvas, name or selection', () => {
  const context = { ...document(), placement: 'fit_selection' };
  assert.throws(() => assertPlacementTarget(context, document({ sessionId: 'session_9999' })), error => error.code === 'PS_SESSION_CHANGED');
  assert.throws(() => assertPlacementTarget(context, document({ documentId: 18 })), error => error.code === 'PS_DOCUMENT_CHANGED');
  assert.throws(() => assertPlacementTarget(context, document({ documentName: '重命名.psd' })), error => error.code === 'PS_DOCUMENT_RENAMED');
  assert.throws(() => assertPlacementTarget(context, document({ canvasWidth: 1400 })), error => error.code === 'PS_CANVAS_CHANGED');
  assert.throws(() => assertPlacementTarget(context, document({ selectionBounds: { left: 0, top: 0, right: 10, bottom: 10 } })), error => error.code === 'PS_SELECTION_CHANGED');
});

test('new document placement does not silently require or guess an active target', () => {
  const request = validatePlaceRequest({
    requestId: 'request_1234', placement: 'new_document', layerName: '生成结果', sourceWidth: 640, sourceHeight: 480,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=', context: null,
  });
  assert.equal(request.plan.requiresTarget, false);
  assert.equal(request.plan.width, 640);
});

test('invalid bounds and unsupported image URLs are rejected before a Photoshop call', () => {
  assert.throws(() => analysisCapturePlan(document({ selectionBounds: { left: 5, top: 5, right: 1300, bottom: 10 } })), error => error.code === 'PS_BOUNDS_INVALID');
  assert.throws(() => validatePlaceRequest({ requestId: 'request_1234', placement: 'new_document', layerName: 'x', sourceWidth: 1, sourceHeight: 1, dataUrl: 'file:///tmp/a.png', context: null }), error => error.code === 'PS_IMAGE_INVALID');
});
