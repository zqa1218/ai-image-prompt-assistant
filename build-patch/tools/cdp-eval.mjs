/**
 * 连上桥接用的 Chrome（CDP），对 ChatGPT 页面执行一段诊断表达式。
 * 用法：node tools/cdp-eval.mjs <port> <urlKeyword> <表达式文件>
 */
import { readFileSync } from 'node:fs'

const [, , portArg, keyword, exprFile] = process.argv
const port = Number(portArg)
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const targets = list.filter((t) => t.type === 'page' && String(t.url).includes(keyword))
if (!targets.length) {
  console.log('没有找到页面，现有 targets：')
  console.log(list.map((t) => `${t.type} ${t.url}`).join('\n'))
  process.exit(1)
}
const target = targets[targets.length - 1]
console.log(`目标: ${target.url}`)

const expression = readFileSync(exprFile, 'utf8')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
})

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP 超时')), 20000)
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== 1) return
    clearTimeout(timer)
    resolve(message)
  })
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }))
})
ws.close()

if (result.error) {
  console.error(JSON.stringify(result.error))
  process.exit(1)
}
const value = result.result?.result?.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
if (result.result?.exceptionDetails) console.error(JSON.stringify(result.result.exceptionDetails))
