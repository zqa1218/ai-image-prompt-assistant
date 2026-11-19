import { describe, expect, it } from 'vitest'
// Server files stay as native ESM JavaScript because Electron and Node execute them directly.
// @ts-expect-error The server module intentionally has no browser-facing declaration bundle.
import { isSafePoseRelativePath, visiblePoseItems } from '../../server/pose.mjs'

describe('姿态库服务端边界', () => {
  it('只接受索引允许的图片相对路径', () => {
    expect(isSafePoseRelativePath('img/full/P001.png')).toBe(true)
    expect(isSafePoseRelativePath('thumbs/P001.jpg')).toBe(true)
    expect(isSafePoseRelativePath('../secret.png')).toBe(false)
    expect(isSafePoseRelativePath('img/../../secret.png')).toBe(false)
    expect(isSafePoseRelativePath('C:\\secret.png')).toBe(false)
  })

  it('成人向姿态默认隐藏，只有显式请求才返回', () => {
    const index = { items: [{ id: 'safe', adult: false }, { id: 'adult', adult: true }] }
    expect(visiblePoseItems(index).map((item: { id: string }) => item.id)).toEqual(['safe'])
    expect(visiblePoseItems(index, true).map((item: { id: string }) => item.id)).toEqual(['safe', 'adult'])
  })
})
