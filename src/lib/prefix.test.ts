import { describe, expect, it } from 'vitest'
import { DEFAULT_ASSETS } from '../workflows/assets.ts'
import { RECOMPOSE, REFINE } from '../workflows/index.ts'
import { buildPrefix, hashPrefix, orderedAssetIds } from './prefix.ts'

describe('缓存前缀', () => {
  it('同一工作流重复构建，结果逐字节一致', () => {
    const a = buildPrefix(REFINE, DEFAULT_ASSETS)
    const b = buildPrefix(REFINE, DEFAULT_ASSETS)
    expect(a).toBe(b)
  })

  it('前缀不依赖阶段：改变阶段顺序不影响前缀', () => {
    const reversed = { ...REFINE, stages: [...REFINE.stages].reverse() }
    expect(buildPrefix(reversed, DEFAULT_ASSETS)).toBe(buildPrefix(REFINE, DEFAULT_ASSETS))
  })

  it('共享资产排在专属资产之前，两条线共享同一段前缀', () => {
    const refineIds = orderedAssetIds(REFINE)
    const recomposeIds = orderedAssetIds(RECOMPOSE)
    expect(refineIds[0]).toBe('analysis-framework')
    expect(recomposeIds[0]).toBe('analysis-framework')

    // 两条线的前缀都应包含共享资产整段文本
    const shared = DEFAULT_ASSETS['analysis-framework']
    expect(buildPrefix(REFINE, DEFAULT_ASSETS)).toContain(shared.trimEnd())
    expect(buildPrefix(RECOMPOSE, DEFAULT_ASSETS)).toContain(shared.trimEnd())
  })

  it('正文内容改动会改变哈希', async () => {
    const base = buildPrefix(REFINE, DEFAULT_ASSETS)
    const tweaked = buildPrefix(REFINE, {
      ...DEFAULT_ASSETS,
      'analysis-framework': DEFAULT_ASSETS['analysis-framework'].replace(
        '主体',
        '主体与陪体',
      ),
    })
    expect(await hashPrefix(base)).not.toBe(await hashPrefix(tweaked))
  })

  it('末尾空白不影响前缀（编辑器加换行不该击穿缓存）', async () => {
    const base = buildPrefix(REFINE, DEFAULT_ASSETS)
    const padded = buildPrefix(REFINE, {
      ...DEFAULT_ASSETS,
      'analysis-framework': `${DEFAULT_ASSETS['analysis-framework']}\n\n   \n`,
    })
    expect(padded).toBe(base)
  })

  it('CRLF 与 LF 归一化后哈希一致', () => {
    const lf: Record<string, string> = { ...DEFAULT_ASSETS }
    const crlf: Record<string, string> = {}
    for (const [id, text] of Object.entries(DEFAULT_ASSETS)) {
      crlf[id] = text.replace(/\n/g, '\r\n')
    }
    expect(buildPrefix(REFINE, crlf)).toBe(buildPrefix(REFINE, lf))
  })

  it('缺少资产时直接报错，而不是静默产出残缺前缀', () => {
    const incomplete = { ...DEFAULT_ASSETS }
    delete incomplete['figure-base-rules']
    expect(() => buildPrefix(REFINE, incomplete)).toThrow(/figure-base-rules/)
  })
})
