import { expect, it } from 'vitest'
import { clampBounds } from './window-state.mjs'
it('丢失显示器、混合 DPI 和小工作区均恢复到可见范围', () => {
  const area = { x: -1707, y: 0, width: 1707, height: 1019 }
  expect(clampBounds({x:3000,y:2000,width:400,height:820},area)).toEqual({x:-400,y:199,width:400,height:820})
  expect(clampBounds({width:400.8,height:820.3},area).width).toBe(401)
  expect(clampBounds({}, {x:0,y:0,width:320,height:400})).toEqual({x:0,y:0,width:320,height:400})
});
