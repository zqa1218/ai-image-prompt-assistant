/** 触发浏览器下载。用 Blob + 临时链接，不依赖任何后端。 */
export function downloadText(filename: string, text: string, mime = 'text/markdown'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** 文件名里不能出现路径分隔符与保留字符。 */
export function safeFilename(base: string, extension: string): string {
  const cleaned = base
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `${cleaned || 'prompt'}${extension}`
}
