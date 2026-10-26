import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'

const source = 'W:/dsh/pw-analyze/pw-patched'
const root = 'W:/dsh/pw-analyze/backups'
const destination = path.join(root, 'before-dual-view-' + new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(destination, { recursive: true })
const manifest = { createdAt: new Date().toISOString(), source, destination, files: [] }
function backup(from, name) {
  if (!existsSync(from)) return
  const to = path.join(destination, name)
  cpSync(from, to, { recursive: true, errorOnExist: true, force: false })
  function verify(dir, relative = '') {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const rel = path.join(relative, item.name)
      assert.ok(!item.isSymbolicLink(), 'Unexpected link: ' + rel)
      if (item.isDirectory()) { verify(path.join(dir, item.name), rel); continue }
      const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex')
      const hash = digest(path.join(from, rel))
      assert.equal(digest(path.join(to, rel)), hash, 'Backup mismatch: ' + rel)
      manifest.files.push({ path: name + '/' + rel.replaceAll('\\', '/'), sha256: hash })
    }
  }
  verify(from)
}
backup(source, 'program')
// Personal data stays local and is never placed in the Git repository.
const appData = process.env.APPDATA
if (appData) {
  const userData = path.join(appData, 'AI修图提示词助手')
  if (existsSync(userData)) {
    // Back up durable application data, not browser caches or live login databases.
    const target = path.join(destination, 'user-data')
    mkdirSync(target)
    for (const item of readdirSync(userData, { withFileTypes: true })) {
      if (item.isFile() && /\.(json|jsonl)$/i.test(item.name)) {
        const content = readFileSync(path.join(userData, item.name))
        writeFileSync(path.join(target, item.name), content, { flag: 'wx' })
        manifest.files.push({ path: 'user-data/' + item.name, sha256: createHash('sha256').update(content).digest('hex') })
      } else if (item.isDirectory() && /^(archives|library|prompt-library)$/i.test(item.name)) backup(path.join(userData, item.name), 'user-data/' + item.name)
    }
  }
}
writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, verifiedFiles: manifest.files.length, programUnchanged: true }))
