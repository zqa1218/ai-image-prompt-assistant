import { cpSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Only source areas; never copy data directories, environment files or dependencies.
const source = 'W:/dsh/pw-analyze/workstation-src'
const destination = path.resolve(import.meta.dirname, '../snapshots/workstation-migration')
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex')
let count = 0
function sync(relative) {
  const from = path.join(source, relative), to = path.join(destination, relative)
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Refusing source symlink')
    const rel = path.join(relative, entry.name)
    if (entry.isDirectory()) { sync(rel); continue }
    assert.ok(!/^\.env|credentials|\.log$/i.test(entry.name), 'Unexpected private file')
    cpSync(path.join(source, rel), path.join(destination, rel))
    assert.equal(hash(path.join(source, rel)), hash(path.join(destination, rel)))
    count++
  }
}
for (const directory of ['src', 'server', 'tests']) sync(directory)
console.log(`Verified ${count} source files; no installed program or user data changed.`)
