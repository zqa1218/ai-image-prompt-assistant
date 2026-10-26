import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const bytes = readFileSync(path.join(root, 'app.asar'))
assert.equal(createHash('sha256').update(bytes).digest('hex'), '380fcb82dcb535f07402474716faefebc108115297fbd3669934b2ef76ed8f23')
const header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)))
const base = 8 + bytes.readUInt32LE(4)
const entries = new Map()
const suspicious = []
const credential = /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/
function inspect(name, content) {
  if (/(?:^|\/)(?:\.env(?:\..*)?|Cookies|Login Data|Local State|settings\.json|profiles\.json|archives\.json)$/i.test(name)) suspicious.push(name)
  if (/\.(?:m?js|json|html|css|md|txt|ps1)$/i.test(name) && credential.test(content.toString())) suspicious.push(name + ': credential-like content')
}
function walk(node, prefix = '') {
  for (const [name, item] of Object.entries(node.files)) {
    const rel = prefix + name
    if (item.files) { walk(item, rel + '/'); continue }
    assert.ok(!item.unpacked && !item.link, rel)
    const content = bytes.subarray(base + Number(item.offset), base + Number(item.offset) + item.size)
    assert.equal(content.length, item.size, rel)
    if (item.integrity) assert.equal(createHash('sha256').update(content).digest('hex'), item.integrity.hash, rel)
    entries.set(rel, content)
    inspect(rel, content)
  }
}
walk(header)
let compared = 0
function checkLocal(dir, prefix = '') {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + item.name, full = path.join(dir, item.name)
    if (item.isDirectory()) { checkLocal(full, rel + '/'); continue }
    const content = readFileSync(full)
    inspect(rel, content)
    if (rel.startsWith('work/')) {
      assert.ok(entries.has(rel.slice(5)), rel)
      assert.deepEqual(content, entries.get(rel.slice(5)), rel)
      compared++
    }
  }
}
checkLocal(root)
assert.deepEqual(suspicious, [], 'Review suspicious paths/content before publishing')
assert.ok(existsSync(path.join(root, 'work/dist/index.html')))
console.log(`PASS: ${entries.size} ASAR files, ${compared} extracted files identical; no common credential signatures or personal config paths found. This is a heuristic scan, not a guarantee.`)
