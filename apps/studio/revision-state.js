export class RevisionScopedCache {
  constructor() { this.values = new Map(); }
  key(taskId, revision) { return `${taskId}@${revision}`; }
  get(taskId, revision) { return this.values.get(this.key(taskId, revision)); }
  set(taskId, revision, value) { this.values.set(this.key(taskId, revision), value); return value; }
  clearTask(taskId) {
    for (const key of this.values.keys()) if (key.startsWith(`${taskId}@`)) this.values.delete(key);
  }
}
