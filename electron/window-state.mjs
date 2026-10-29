import { readFileSync, writeFileSync, renameSync } from 'node:fs'

export function clampBounds(bounds, area) {
  const n = (value, fallback) => Number.isFinite(value) ? Math.round(value) : fallback
  const width = Math.min(area.width, Math.max(360, n(bounds?.width, 1100)))
  const height = Math.min(area.height, Math.max(480, n(bounds?.height, 820)))
  return {
    x: Math.min(area.x + area.width - width, Math.max(area.x, n(bounds?.x, area.x))),
    y: Math.min(area.y + area.height - height, Math.max(area.y, n(bounds?.y, area.y))),
    width, height,
  }
}
export function readWindowState(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}
export function saveWindowState(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value), 'utf8')
  renameSync(`${file}.tmp`, file)
}
