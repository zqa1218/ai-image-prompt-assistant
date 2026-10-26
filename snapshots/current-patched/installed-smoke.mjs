import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const target = 'W:/dsh/pw-analyze/pw-patched'
const data = mkdtempSync(path.join(os.tmpdir(), 'pw-installed-smoke-'))
const reserve = http.createServer()
await new Promise(r => reserve.listen(0, '127.0.0.1', r))
const port = reserve.address().port
await new Promise(r => reserve.close(r))
const packagePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(target, 'resources/app.asar')
const entry = pathToFileURL(path.join(packagePath, 'server/index.mjs')).href
const code = `
(async()=>{
  const {ready}=await import(${JSON.stringify(entry)});await ready;
  const base='http://127.0.0.1:${port}';
  for(const route of ['/api/health','/api/iteration/settings','/assets/iteration-core.mjs','/assets/iteration-ui.js','/api/library','/assets/library-core.mjs','/assets/library-ui.js','/assets/model-presets.mjs']){
    const r=await fetch(base+route);if(!r.ok)throw Error(route+' HTTP '+r.status);
    if(route.endsWith('.mjs')&&!r.headers.get('content-type').includes('javascript'))throw Error('Invalid module MIME');
    console.log('PASS installed Electron ASAR '+route);
  }
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});`
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PW_API_PORT: String(port), PROMPT_WIZARD_DATA_DIR: data, PROMPT_WIZARD_BRIDGE_DIR: data }
delete env.DEEPSEEK_API_KEY
const result = spawnSync(path.join(target, 'AI修图提示词助手.exe'), ['-e', code], { env, windowsHide: true, encoding: 'utf8', timeout: 20000 })
console.log(result.stdout)
if (result.stderr) console.error(result.stderr)
assert.equal(result.status, 0, result.error?.message)
