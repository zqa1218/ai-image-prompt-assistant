import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import { zipDirectory } from './zip.mjs'

const root = path.resolve(import.meta.dirname, '..')
const source = 'W:/dsh/pw-analyze/workstation-src'
const program = 'W:/dsh/pw-analyze/pw-patched'
const snapshot = path.join(root, 'snapshots/workstation-migration')
const output = path.join(root, 'release/workstation-checkpoint-20261026')
mkdirSync(output, { recursive: true })
mkdirSync(snapshot, { recursive: true })
const allowed = ['assets', 'electron', 'photoshop-plugin', 'public', 'scripts', 'server', 'shared', 'src', 'tests', '.gitattributes', '.gitignore', 'index.html', 'package-lock.json', 'package.json', 'README.md', 'tsconfig.json', 'vite.config.ts']
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const files = []
function copyVerified(from, to, prefix) {
  assert.ok(!lstatSync(from).isSymbolicLink(), 'Refusing symlink: ' + prefix)
  if (lstatSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) copyVerified(path.join(from, name), path.join(to, name), prefix + '/' + name)
  } else {
    assert.ok(!/(^|\/)(\.env(?:\..+)?|.*credentials.*|.*\.log)$/i.test(prefix), 'Unexpected private file: ' + prefix)
    cpSync(from, to, { force: false, errorOnExist: true })
    const sha256 = hash(from)
    assert.equal(hash(to), sha256)
    files.push({ path: prefix, sha256 })
  }
}
for (const name of allowed) copyVerified(path.join(source, name), path.join(snapshot, name), 'source/' + name)
const staging = path.join(output, 'program')
mkdirSync(staging)
for (const name of readdirSync(program)) {
  // An installed uninstaller must not travel with a separately extracted copy.
  if (/^Uninstall /i.test(name)) continue
  copyVerified(path.join(program, name), path.join(staging, name), 'program/' + name)
}
assert.equal(hash(path.join(staging, 'resources/app.asar')), hash(path.join(root, 'snapshots/current-patched/app.asar')))
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ kind: 'current-runtime-and-incomplete-source-checkpoint', files }, null, 2), { flag: 'wx' })
const zip = path.join(output, 'prompt-wizard-current-win-x64.zip')
zipDirectory(staging, zip, 'prompt-wizard')
writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${hash(zip)}  ${path.basename(zip)}\n${hash(path.join(output, 'manifest.json'))}  manifest.json\n`, { flag: 'wx' })
console.log(JSON.stringify({ output, verifiedFiles: files.length, zipSHA256: hash(zip) }))
