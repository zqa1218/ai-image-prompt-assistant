import type { ImageRef } from './wizardTypes.ts'

/** 长边上限：DeepSeek 请求体硬上限 48 MiB，base64 还会膨胀约 33%。 */
export const MAX_EDGE = 1568
export const JPEG_QUALITY = 0.85
export const REQUEST_BODY_LIMIT_BYTES = 48 * 1024 * 1024
/** 超过这个体积就重新编码，避免直接上传几 MB 的原图。 */
const REENCODE_THRESHOLD_BYTES = 2 * 1024 * 1024

/**
 * 服务端只接受这四种格式（按文件内容识别，不看扩展名）。
 * 其它格式一律在浏览器里转码后再上传 —— 不能指望用户的文件正好是支持的格式。
 */
export const SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

/** 从 data URL 头部取出 MIME；`data:;base64,...` 这类无类型的情况返回空串。 */
export function mimeOf(dataUrl: string): string {
  const match = /^data:([^;,]*)[;,]/.exec(dataUrl)
  return match ? match[1].toLowerCase() : ''
}

/** 源格式不被支持、或体积/尺寸超标时，都必须转码。 */
export function needsNormalization(
  image: Pick<ImageRef, 'width' | 'height' | 'bytes' | 'dataUrl'>,
): boolean {
  const longest = Math.max(image.width, image.height)
  return (
    longest > MAX_EDGE ||
    image.bytes > REENCODE_THRESHOLD_BYTES ||
    !SUPPORTED_MIME.has(mimeOf(image.dataUrl))
  )
}

/** 有透明通道时用 PNG 保真，否则用 JPEG 控制体积。 */
export function pickOutputType(hasAlpha: boolean): 'image/jpeg' | 'image/png' {
  return hasAlpha ? 'image/png' : 'image/jpeg'
}

/**
 * 按文件头判断真实格式。
 *
 * 不能依赖 `file.type`：Windows 上 `.jpg` 的 MIME 注册项可能是缺失的，
 * 浏览器会报空类型，FileReader 再把它变成 application/octet-stream。
 * 按内容识别才可靠 —— 服务端也是按内容识别的。
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const at = (...expected: number[]) =>
    bytes.length >= expected.length && expected.every((value, i) => bytes[i] === value)

  if (at(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  // WebP: "RIFF" .... "WEBP"
  if (
    at(0x52, 0x49, 0x46, 0x46) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * 自己拼 data URL，MIME 完全由调用方指定。
 *
 * 不用 FileReader + `new File([blob])`：File 构造器不会继承 Blob 的 type，
 * 会把转码结果又变回 application/octet-stream，等于白转。
 */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

function readSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('无法解析图片尺寸'))
    img.src = dataUrl
  })
}

/** 读入本地文件，按文件内容确定真实类型；压缩与转码由 normalizeForUpload 负责。 */
export async function loadImageFile(file: File): Promise<ImageRef> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const declared = (file.type || '').toLowerCase()
  const mime = sniffMime(bytes) ?? declared
  const dataUrl = toDataUrl(bytes, mime)
  const { width, height } = await readSize(dataUrl)
  return { name: file.name, dataUrl, width, height, bytes: file.size, sourceMime: declared }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('无法解析图片'))
    img.src = dataUrl
  })
}

async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return toDataUrl(new Uint8Array(await blob.arrayBuffer()), mime)
}

/** base64 data URL 的实际传输字节数（含头部与膨胀）。 */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

export function estimateUploadBytes(images: ImageRef[]): number {
  return images.reduce((sum, image) => sum + dataUrlBytes(image.dataUrl), 0)
}

/** 判断画布上是否存在透明像素，用来决定转码成 PNG 还是 JPEG。 */
function alphaPresent(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  try {
    const data = context.getImageData(0, 0, width, height).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true
    }
  } catch {
    // 取不到像素时按不透明处理
  }
  return false
}

/**
 * 入库前归一化：**保证发出去的 data URL 一定是服务端支持的格式**。
 *
 * 不能假设用户的文件本身就是 JPEG/PNG/WebP/GIF —— AVIF、HEIC、BMP、SVG，
 * 或者浏览器认不出类型（file.type 为空）都会产出不支持的 data URL。
 * 所以这里判断的是「能不能直接用」，而不是「是不是太大」。
 *
 * 源格式已受支持、且尺寸体积都在限内时原样放行，避免无意义的重编码损失。
 */
export async function normalizeForUpload(image: ImageRef): Promise<ImageRef> {
  const sourceMime = mimeOf(image.dataUrl)
  if (!needsNormalization(image)) {
    return { ...image, sourceMime }
  }

  const longest = Math.max(image.width, image.height)
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1
  const targetWidth = Math.max(1, Math.round(image.width * scale))
  const targetHeight = Math.max(1, Math.round(image.height * scale))

  const element = await loadImage(image.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('浏览器无法创建画布，无法转码这张图片')
  }
  context.drawImage(element, 0, 0, targetWidth, targetHeight)

  const type = pickOutputType(alphaPresent(context, targetWidth, targetHeight))
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined),
  )
  if (!blob) {
    throw new Error('图片转码失败，请换一张图片重试')
  }

  return {
    name: image.name,
    dataUrl: await blobToDataUrl(blob, type),
    width: targetWidth,
    height: targetHeight,
    bytes: blob.size,
    originalBytes: image.originalBytes ?? image.bytes,
    sourceMime,
  }
}

/**
 * 发送前兜底：万一有图片绕过了归一化，这里给出可读的提示，
 * 而不是让服务端返回一句难以定位的 "unsupported image"。
 */
export function assertSupportedImages(images: ImageRef[]): void {
  for (const image of images) {
    const mime = mimeOf(image.dataUrl)
    if (!SUPPORTED_MIME.has(mime)) {
      throw new Error(
        `图片「${image.name}」的类型是 ${mime || '未知'}，服务端只接受 JPEG / PNG / WebP / GIF。` +
          `请重新选择图片，或先把图片转成这几种格式。`,
      )
    }
  }
}

/** 请求体预检：超限时给出可执行的提示，而不是让上游返回一个难懂的 400。 */
export function assertWithinLimit(images: ImageRef[]): void {
  const total = estimateUploadBytes(images)
  if (total > REQUEST_BODY_LIMIT_BYTES) {
    throw new Error(
      `图片总量 ${formatBytes(total)} 超过单次请求上限 ${formatBytes(REQUEST_BODY_LIMIT_BYTES)}，` +
        `请减少图片数量或先压缩`,
    )
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
