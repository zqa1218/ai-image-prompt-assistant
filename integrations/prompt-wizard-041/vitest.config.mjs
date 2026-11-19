import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
export default {
  test: { root: path.join(root, 'apps/prompt-wizard-installed'), include: ['server/**/*.test.mjs', 'electron/**/*.test.mjs'], environment: 'node', maxWorkers: 2, pool: 'threads' },
};
