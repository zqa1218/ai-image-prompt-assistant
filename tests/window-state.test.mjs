import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBounds } from '../apps/prompt-wizard-next/electron/window-state.mjs';

const area = { x: 100, y: 50, width: 1200, height: 800 };

test('candidate desktop window state stays inside the active display', () => {
  assert.deepEqual(clampBounds({ x: -4000, y: 9000, width: 3000, height: 100 }, area), { x: 100, y: 370, width: 1200, height: 480 });
  assert.deepEqual(clampBounds(null, area), { x: 100, y: 50, width: 1100, height: 800 });
});
