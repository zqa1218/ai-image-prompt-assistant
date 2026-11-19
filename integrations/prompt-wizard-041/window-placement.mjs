// 登录用的浏览器窗口（真实 Chrome / Edge，经 CDP 控制）必须落在用户看得见的屏幕上。
// 0.4.1 的 show() 只在窗口横坐标 < -10000 时才挪回来，而 Gemini 的后台位置按屏幕算出来常是 -1380 左右，
// 于是“登录账号”打开的窗口一直停在屏幕左边外面。这里按实际屏幕工作区判断，并把窗口放到用户正在用的那块屏幕中间。

/**
 * @param {{left?: number, top?: number, width?: number, height?: number}|undefined} bounds 窗口当前位置（CDP Browser.getWindowBounds）
 * @param {{x: number, y: number, width: number, height: number}[]} areas 所有屏幕的工作区
 * @param {{x: number, y: number, width: number, height: number}|undefined} target 要放到的屏幕工作区（一般是鼠标所在屏幕）
 * @returns 需要移动时返回新位置；已经在某块屏幕里时返回 null
 */
export function visibleBounds(bounds, areas = [], target = areas[0]) {
  const left = Number.isFinite(bounds?.left) ? bounds.left : -30000;
  const top = Number.isFinite(bounds?.top) ? bounds.top : 0;
  const width = bounds?.width || 1180, height = bounds?.height || 900;
  // 标题栏左段（约 200×40）落在某块屏幕的工作区里，用户就能看到并拖动它。
  const grab = { left, top, right: left + Math.min(width, 200), bottom: top + 40 };
  const onScreen = areas.length
    ? areas.some(area => grab.left >= area.x - 8 && grab.top >= area.y - 8 && grab.right <= area.x + area.width + 8 && grab.bottom <= area.y + area.height + 8)
    : left > -1000;
  if (onScreen) return null;
  const area = target ?? { x: 0, y: 0, width: 1280, height: 800 };
  const w = Math.max(320, Math.min(width, area.width - 40));
  const h = Math.max(320, Math.min(height, area.height - 40));
  return {
    left: Math.round(area.x + Math.max(0, (area.width - w) / 2)),
    top: Math.round(area.y + Math.max(0, (area.height - h) / 2)),
    width: Math.round(w), height: Math.round(h),
  };
}

/** 由工作台 main.mjs 在 app ready 后注册的屏幕信息；拿不到时按“只看横坐标”的旧规则兜底。 */
export function placeOnScreen(bounds) {
  let areas = [], target;
  try { areas = globalThis.promptWizardWorkAreas?.() ?? []; } catch { areas = []; }
  try { target = globalThis.promptWizardActiveWorkArea?.(); } catch { target = undefined; }
  return visibleBounds(bounds, areas, target ?? areas[0]);
}
