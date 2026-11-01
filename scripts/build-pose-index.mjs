/**
 * 生成姿势参考库索引。
 *
 * 来源：外部库（默认 W:\dsh\ref-libs）下的 _catalog/catalog.csv。
 * 产物：data/pose-index.json（提交进 git，图片不进）、data/pose-index.meta.json。
 *
 * 设计取舍：
 * - 只存元数据，图片路径存相对库根的路径，前端通过 /api/pose/file 取图；
 * - 姿势库原库「标签」列为空，这里生成派生标签（体系/动作/视角/名称词），
 *   并标记 derived=true，用户自定义标签走单独的本地覆盖表，不污染上游。
 * - 18+ 分类打 adult 标记，由前端默认屏蔽。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.POSE_LIB_ROOT || 'W:/dsh/ref-libs'
const CATALOG = path.join(ROOT, '_catalog', 'catalog.csv')
const OUT_DIR = 'W:/dsh/pw-repo/data'

if (!existsSync(CATALOG)) {
  console.error('找不到 catalog.csv：', CATALOG)
  process.exit(1)
}

/** 极简 CSV 解析：支持引号包裹与 "" 转义，够用且无依赖。 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    if (ch === '\r') continue
    field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const raw = readFileSync(CATALOG, 'utf8').replace(/^\uFEFF/, '')
const table = parseCsv(raw)
const header = table.shift()
const col = Object.fromEntries(header.map((name, i) => [name.trim(), i]))

const libOf = (value) => {
  if (value.includes('姿势')) return 'pose'
  if (value.includes('服装')) return 'costume'
  if (value.includes('人像')) return 'portrait'
  return 'other'
}

/** 名称里的关键动作词，用于派生标签（只取可观察的动作/部位，不做语义猜测）。 */
const NAME_HINTS = [
  ['跪', '跪姿'], ['蹲', '蹲姿'], ['坐', '坐姿'], ['躺', '躺姿'], ['卧', '卧姿'],
  ['趴', '趴卧'], ['站', '站姿'], ['跪立', '跪立'], ['前倾', '前倾'], ['后仰', '后仰'],
  ['扭', '扭身'], ['侧身', '侧身'], ['回眸', '回眸'], ['举手', '举手'], ['抬手', '抬手'],
  ['叉腰', '叉腰'], ['抱', '抱'], ['撑', '撑地'], ['抬腿', '抬腿'], ['盘腿', '盘腿'],
  ['倾', '倾斜'], ['背向', '背向'], ['背对', '背对'], ['俯身', '俯身'],
]

/** 18+ 判定：上游把这两个体系标为成人向。 */
const ADULT_L1 = new Set(['全身单人・性感系', '双人缠绵'])
const ADULT_L2 = new Set(['性感・大胆系', '挤胸・强调事业线系'])

function buildRow(values) {
  const lib = libOf(values[col['库']] ?? '')
  const l1 = (values[col['一级分类']] ?? '').trim()
  const l2 = (values[col['二级分类']] ?? '').trim()
  const l3 = (values[col['三级分类']] ?? '').trim()
  const name = (values[col['名称']] ?? '').trim()
  const tags = (values[col['标签']] ?? '').split('|').map((t) => t.trim()).filter(Boolean)
  const kw = (values[col['英文关键词']] ?? '').trim()
  const hair = (values[col['发型']] ?? '').trim()
  const hairLength = (values[col['发长']] ?? '').trim()
  const group = (values[col['编号']] ?? '').trim()

  // 派生标签：只在原标签为空时补，且显式标记来源，方便前端区分
  const derived = []
  if (tags.length === 0) {
    for (const [needle, tag] of NAME_HINTS) if (name.includes(needle)) derived.push(tag)
    if (l2) derived.push(l2)
  }

  return {
    id: (values[col['ID']] ?? '').trim(),
    lib,
    l1, l2, l3,
    name,
    group,
    tags,
    derived: [...new Set(derived)],
    kw,
    hair,
    hairLength,
    thumb: (values[col['缩略图']] ?? '').trim(),
    img: (values[col['原图']] ?? '').trim(),
    adult: ADULT_L1.has(l1) || ADULT_L2.has(l2),
  }
}

const items = []
const seen = new Set()
for (const values of table) {
  if (!values.length || !values[col['ID']]) continue
  const row = buildRow(values)
  if (!row.id || seen.has(row.id)) continue
  seen.add(row.id)
  items.push(row)
}

// 维度统计：前端并列选择栏直接用这些值，保证「选项一定存在」
const facet = (key) => {
  const map = new Map()
  for (const item of items) {
    const value = item[key]
    if (!value) continue
    map.set(value, (map.get(value) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
}

const tagCount = new Map()
for (const item of items) {
  for (const tag of [...item.tags, ...item.derived]) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
}
const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))

const index = {
  version: 1,
  builtAt: new Date().toISOString(),
  facets: {
    lib: facet('lib'),
    l1: facet('l1'),
    l2: facet('l2'),
    l3: facet('l3'),
    hairLength: facet('hairLength'),
    hair: facet('hair'),
    tags,
  },
  items,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, 'pose-index.json'), JSON.stringify(index), 'utf8')

// 抽样校验：每个库抽 5 条，确认原图文件真的在
const sampleProblems = []
for (const lib of ['pose', 'costume', 'portrait']) {
  const sample = items.filter((i) => i.lib === lib).slice(0, 5)
  for (const item of sample) {
    const abs = path.join(ROOT, 'ai-pose-gallery-zh', item.img)
    if (!existsSync(abs)) sampleProblems.push(`${item.id} → ${item.img}`)
  }
}

const meta = {
  root: ROOT,
  builtAt: index.builtAt,
  counts: {
    total: items.length,
    pose: items.filter((i) => i.lib === 'pose').length,
    costume: items.filter((i) => i.lib === 'costume').length,
    portrait: items.filter((i) => i.lib === 'portrait').length,
    adult: items.filter((i) => i.adult).length,
  },
  tags: tags.length,
  sampleProblems,
  sizeBytes: statSync(path.join(OUT_DIR, 'pose-index.json')).size,
}
writeFileSync(path.join(OUT_DIR, 'pose-index.meta.json'), JSON.stringify(meta, null, 2), 'utf8')

console.log('索引已生成')
console.log('  总数', meta.counts.total, '｜姿势', meta.counts.pose, '｜服装', meta.counts.costume, '｜人像', meta.counts.portrait)
console.log('  成人向标记', meta.counts.adult, '条')
console.log('  标签维度', meta.tags, '个')
console.log('  索引体积', (meta.sizeBytes / 1048576).toFixed(2), 'MB')
if (sampleProblems.length) console.log('  ！抽样缺图:', sampleProblems.slice(0, 5))
