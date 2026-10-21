/** 用真实的模型返回形状，验证 MJ 产物拼装（完整一行 / 正面 / 负面 / 参数）。 */
import { readFileSync } from 'node:fs'

const snippet = readFileSync('W:/dsh/pw-analyze/patch/edits/mj_parse.js', 'utf8').trimEnd()
// 补丁片段原本位于 async function Gu(){…} 内部，末尾那个 } 是 Gu 的收尾，测试时要剥掉
const body = snippet.slice(0, snippet.lastIndexOf('}'))
const build = new Function('r', 'i', 'Wu', 'e', `var o={run(){${body}}}; return o.run()`)

const r = {
  ok: true,
  data: {
    sections: [
      { key: '正面提示词', body: 'a young East Asian woman with platinum blonde short hair, kneeling, studio photography, grey paper backdrop, 85mm portrait lens' },
      { key: '负面提示词', body: 'scythe, weapon, anime, 3d render, plastic smooth skin, extra limbs' },
    ],
    params: ['--ar 3:4', '--v 6.0', '--style raw', '--stylize 150'],
    channel: 'Midjourney 官网',
    checklist: ['确认比例', '确认 --no'],
  },
}

const out = build(r, (x) => String(x || '').trim(), () => '默认通道', {})
const sections = out.prompt.split(/\n\n(?=【)/)
console.log(`产出 ${sections.length} 块：`)
for (const block of sections) {
  const line = block.split('\n')[0]
  const body = block.slice(line.length).trim()
  console.log(`\n${line}\n${body}`)
}

const full = sections[0].split('\n').slice(1).join('\n').trim()
const expect = /--ar 3:4/.test(full) && /--no scythe, weapon, anime/.test(full) && /85mm portrait lens/.test(full)
console.log(`\n完整一行含 正面+参数+--no：${expect}`)
console.log(`块标题：${sections.map((s) => s.split('\n')[0]).join(' / ')}`)
