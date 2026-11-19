import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionScopedCache } from '../apps/studio/revision-state.js';

test('revision-scoped UI evidence never leaks from revision 1 into revision 2', () => {
  const handoffs = new RevisionScopedCache();
  const exports = new RevisionScopedCache();
  handoffs.set('task_1', 1, { promptText: 'revision one' });
  exports.set('task_1', 1, 'exports/task_1-r1');

  assert.equal(handoffs.get('task_1', 2), undefined);
  assert.equal(exports.get('task_1', 2), undefined);
  assert.equal(handoffs.get('task_1', 1).promptText, 'revision one');
  assert.equal(exports.get('task_1', 1), 'exports/task_1-r1');
});

test('clearing one task leaves another task revision evidence intact', () => {
  const cache = new RevisionScopedCache();
  cache.set('task_1', 1, 'first');
  cache.set('task_1', 2, 'second');
  cache.set('task_2', 1, 'other');
  cache.clearTask('task_1');
  assert.equal(cache.get('task_1', 1), undefined);
  assert.equal(cache.get('task_1', 2), undefined);
  assert.equal(cache.get('task_2', 1), 'other');
});
