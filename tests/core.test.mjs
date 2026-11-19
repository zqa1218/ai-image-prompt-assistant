import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDraft } from '../packages/core/draft.mjs';
import { validateInput } from '../packages/core/validation.mjs';
import { compileMj } from '../packages/core/mj-handoff.mjs';
import { fromPromptWizard } from '../packages/adapters/prompt-wizard.mjs';

const errorCode = code => error => error.code === code;
test('typed MJ values retain zero and compile a bare raw flag', () => {
  const draft = makeDraft('A quiet forest');
  Object.assign(draft.settings, { raw: true, chaos: 0, weird: 0, stylize: 0, seed: 0 });
  const result = compileMj(draft);
  assert.equal(result.promptText, 'A quiet forest --s 0 --chaos 0 --weird 0 --seed 0 --raw');
  assert.ok(!result.promptText.includes('True'));
});
test('false and null do not add flags; false is explicitly in the website checklist', () => {
  const draft = makeDraft('Forest'); draft.settings.raw = false;
  const result = compileMj(draft);
  assert.equal(result.promptText, 'Forest'); assert.ok(result.websiteChecklist.some(x => x.includes('明确关闭')));
});
test('website-only settings are never silently turned into CLI flags', () => {
  const draft = makeDraft('Forest'); Object.assign(draft.settings, { modelVersion: 'future-version', speed: 'relax', resolution: 'hd' });
  const result = compileMj(draft); assert.equal(result.promptText, 'Forest'); assert.ok(result.websiteChecklist.join().includes('future-version'));
});
for (const text of ['Forest --ar 2:3', 'Forest\n--raw', '--v 7 Portrait']) {
  test(`reject inline parameter conflicts: ${JSON.stringify(text)}`, () => assert.throws(() => compileMj(makeDraft(text)), errorCode('INLINE_PARAMETER_CONFLICT')));
}
test('unreviewed extra parameters are blocked', () => {
  const draft = makeDraft('Forest'); draft.settings.extraParameters = '--tile';
  assert.throws(() => compileMj(draft), errorCode('EXTRA_PARAMETERS_UNREVIEWED'));
});
test('empty drafts are allowed but cannot be prepared', () => {
  validateInput(makeDraft(' ')); assert.throws(() => compileMj(makeDraft(' ')), errorCode('PROMPT_EMPTY'));
});
test('strict contract rejects unknown properties, invalid dates and integer strings', () => {
  for (const patch of [{ surprise: true }, { createdAt: 'yesterday' }, { revision: '1' }]) assert.throws(() => validateInput({ ...makeDraft('x'), ...patch }), errorCode('INVALID_INPUT'));
});
test('confirmation must match its revision', () => {
  const draft = makeDraft('x'); draft.confirmation = { revision: 2, confirmedAt: new Date().toISOString(), promptReviewed: true, settingsReviewed: true, referencesReviewed: true };
  assert.throws(() => validateInput(draft), errorCode('CONFIRMATION_MISMATCH'));
});
test('banana is not a MJ adapter', () => assert.throws(() => compileMj(makeDraft('x', 'banana_api')), errorCode('WRONG_MODE')));
test('Prompt Wizard import preserves suggestions without assuming selected params or assets', () => {
  const draft = fromPromptWizard({ prompt: 'Forest', channel: 'MJ', params: ['--ar 2:3', '--ar 1:1'], checklist: ['Check light'] }, 'mj_web');
  assert.equal(draft.settings.aspectRatio, null); assert.equal(draft.references.length, 0); assert.equal(draft.prompt.workflowId, null);
  assert.equal(draft.prompt.source, 'prompt_wizard'); assert.match(draft.prompt.intent, /不包含生产参考图/); assert.equal(draft.settings.websiteChecklist.length, 3);
});
test('Banana Artifact export keeps provenance and no provider guess', () => {
  const draft = fromPromptWizard({ prompt: 'Edit fabric', channel: 'Banana', params: ['high quality'] }, 'banana_api');
  assert.match(draft.prompt.intent, /high quality/); assert.equal(draft.settings.providerId, null);
});
test('invalid Prompt Wizard artifact fails instead of creating empty success', () => {
  for (const artifact of [null, {}, { prompt: 42 }, { prompt: 'x', params: [null] }]) assert.throws(() => fromPromptWizard(artifact, 'mj_web'), errorCode('INVALID_ARTIFACT'));
});
test('V8.2 capability table blocks unsupported Turbo and excessive HD aspect ratio', () => {
  const draft = makeDraft('Forest'); draft.settings.modelVersion = '8.2'; draft.settings.speed = 'turbo';
  assert.throws(() => compileMj(draft), errorCode('MJ_CAPABILITY_CONFLICT'));
  draft.settings.speed = 'fast'; draft.settings.resolution = 'hd'; draft.settings.aspectRatio = '16:1';
  assert.throws(() => compileMj(draft), errorCode('MJ_ASPECT_RATIO_LIMIT'));
});
test('V8 editing requires one to four edit references', () => {
  const draft = makeDraft('Change the fabric'); draft.operation = 'edit'; draft.settings.modelVersion = '8.2';
  assert.throws(() => compileMj(draft), errorCode('MJ_EDIT_REFERENCE_REQUIRED'));
  const reference = { assetId: 'edit_1', path: 'assets/edit.png', mediaType: 'image/png', width: 1, height: 1, bytes: 68, sha256: null, role: 'edit_reference', source: 'upload', analysisOnly: false };
  draft.references = [reference]; assert.match(compileMj(draft).websiteChecklist.join('\n'), /edit_reference/);
  draft.references = Array.from({ length: 5 }, (_, index) => ({ ...reference, assetId: `edit_${index}`, path: `assets/edit-${index}.png` }));
  assert.throws(() => compileMj(draft), errorCode('MJ_EDIT_REFERENCE_LIMIT'));
});
test('legacy and Banana-only roles never silently enter MJ handoff', () => {
  for (const role of ['base', 'character_reference', 'mask']) {
    const draft = makeDraft('Forest'); draft.references = [{ assetId: `role_${role}`, path: `assets/${role}.png`, mediaType: 'image/png', width: 1, height: 1, bytes: 68, sha256: null, role, source: 'upload', analysisOnly: false }];
    assert.throws(() => compileMj(draft), errorCode('ROLE_REQUIRES_ADAPTER'));
    draft.references[0].analysisOnly = true; assert.equal(compileMj(draft).promptText, 'Forest');
  }
});
