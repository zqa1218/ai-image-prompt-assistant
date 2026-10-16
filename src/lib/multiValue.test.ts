import { describe, expect, it } from 'vitest'
import { isAllSelected, parseMulti, setMultiAll, toggleMulti } from './multiValue.ts'

const PRESERVE = ['人物身份与脸', '发色与刘海', '服装与道具']

describe('多选字段的全选与清空', () => {
  it('全选补齐缺失项，且不产生重复项', () => {
    expect(setMultiAll('', PRESERVE, true)).toBe(PRESERVE.join(','))
    // 已选中的顺序保留，缺的按定义顺序补在后面
    expect(setMultiAll('发色与刘海', PRESERVE, true)).toBe('发色与刘海,人物身份与脸,服装与道具')
    expect(setMultiAll('服装与道具,发色与刘海', PRESERVE, true)).toBe(
      '服装与道具,发色与刘海,人物身份与脸',
    )
  })

  it('取消全选只清本字段的选项，别的值留着', () => {
    expect(setMultiAll(PRESERVE.join(','), PRESERVE, false)).toBe('')
    expect(setMultiAll('其它值,发色与刘海', PRESERVE, false)).toBe('其它值')
  })

  it('isAllSelected 要求每一项都已勾选', () => {
    expect(isAllSelected(PRESERVE.join(','), PRESERVE)).toBe(true)
    expect(isAllSelected('人物身份与脸', PRESERVE)).toBe(false)
    expect(isAllSelected('', [])).toBe(false)
  })

  it('单项勾选仍然是只增删一项', () => {
    expect(parseMulti(toggleMulti('a', 'b'))).toEqual(['a', 'b'])
    expect(parseMulti(toggleMulti('a,b', 'a'))).toEqual(['b'])
  })
})
