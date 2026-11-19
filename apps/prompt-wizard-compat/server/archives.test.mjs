import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const image = (name) => ({
  name,
  dataUrl: 'data:image/png;base64,AAAA',
  width: 100,
  height: 80,
  bytes: 3,
})

it('存档可保存、列出、载入、覆盖与删除，并校验载荷', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-archives-test-'))
  vi.stubEnv('PROMPT_WIZARD_DATA_DIR', dir)
  try {
    const { ArchiveError, deleteArchive, listArchives, readArchive, saveArchive } = await import(
      './archives.mjs'
    )

    expect(listArchives()).toEqual([])

    const meta = saveArchive({
      name: ' 人像白底 ',
      workflowId: 'refine',
      intake: { requirement: '保持人物不变', preserve: '人物身份与脸' },
      original: image('base.png'),
      references: [{ ...image('ref.png'), note: '仅借用蓝色光效，不改变人物' }],
      thumb: 'data:image/jpeg;base64,AA',
      id: 'not-a-real-id',
    })
    expect(meta).toMatchObject({
      name: '人像白底',
      workflowId: 'refine',
      imageCount: 2,
      hasOriginal: true,
    })
    expect(meta.id).toMatch(/^[a-z0-9]{8,32}$/)
    expect(meta.thumb).toBe('data:image/jpeg;base64,AA')
    expect(listArchives()).toHaveLength(1)

    // 列表项不含图片本体，只有缩略图与统计；单份读取才拿到 data URL
    const record = readArchive(meta.id)
    expect(record.intake.requirement).toBe('保持人物不变')
    expect(record.original.dataUrl).toBe('data:image/png;base64,AAAA')
    expect(record.original).not.toHaveProperty('role')
    expect(record.references).toHaveLength(1)
    expect(record.references[0].note).toBe('仅借用蓝色光效，不改变人物')

    // 覆盖：带 id 原地更新，条数不变、创建时间不变
    const updated = saveArchive({
      id: meta.id,
      name: '人像白底 v2',
      workflowId: 'refine',
      intake: {},
      original: null,
      references: [],
    })
    expect(updated.id).toBe(meta.id)
    expect(updated.createdAt).toBe(meta.createdAt)
    expect(listArchives()).toHaveLength(1)
    expect(listArchives()[0].name).toBe('人像白底 v2')
    expect(readArchive(meta.id).original).toBeNull()

    // 异常退出可能留下完整存档文件和旧索引；列表应自动发现并修复索引。
    const orphan = { ...readArchive(meta.id), id: 'orphan123', name: '索引外存档' }
    writeFileSync(path.join(dir, 'archives', 'orphan123.json'), JSON.stringify(orphan), 'utf8')
    expect(listArchives().map((item) => item.id).sort()).toEqual([meta.id, 'orphan123'].sort())

    // 载荷校验
    expect(() => saveArchive({ name: '  ', workflowId: 'refine' })).toThrow(ArchiveError)
    expect(() => saveArchive({ name: 'x', workflowId: '' })).toThrow(/工作路径/)
    expect(() =>
      saveArchive({
        name: 'x',
        workflowId: 'refine',
        original: { name: 'a', dataUrl: 'https://example.com/a.png' },
      }),
    ).toThrow(/图片数据/)
    expect(readArchive('../../../etc/passwd')).toBeNull()
    expect(() => deleteArchive('../..')).toThrow(ArchiveError)

    expect(deleteArchive(meta.id)).toBe(true)
    expect(deleteArchive('orphan123')).toBe(true)
    expect(listArchives()).toEqual([])
    expect(deleteArchive(meta.id)).toBe(false)
  } finally {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})
