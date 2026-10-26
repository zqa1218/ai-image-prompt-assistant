import { describe, expect, it } from 'vitest'
import {
  MAX_EDGE,
  assertSupportedImages,
  mimeOf,
  needsNormalization,
  pickOutputType,
  sniffMime,
  SUPPORTED_MIME,
  toDataUrl,
} from './image.ts'
import type { ImageRef } from './wizardTypes.ts'

function makeImage(overrides: Partial<ImageRef> = {}): ImageRef {
  return {
    name: 'sample.jpg',
    dataUrl: 'data:image/jpeg;base64,AAAA',
    width: 1000,
    height: 1000,
    bytes: 500_000,
    ...overrides,
  }
}

describe('data URL 类型识别', () => {
  it('能读出常见类型', () => {
    expect(mimeOf('data:image/jpeg;base64,AAAA')).toBe('image/jpeg')
    expect(mimeOf('data:image/png;base64,AAAA')).toBe('image/png')
    expect(mimeOf('data:image/webp;base64,AAAA')).toBe('image/webp')
    expect(mimeOf('data:image/gif;base64,AAAA')).toBe('image/gif')
  })

  it('类型为空或认不出时返回空串', () => {
    expect(mimeOf('data:;base64,AAAA')).toBe('')
    expect(mimeOf('data:,AAAA')).toBe('')
    expect(mimeOf('随便一段文字')).toBe('')
  })
})

describe('按文件头识别格式', () => {
  it('识别四种受支持的格式', () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe('image/jpeg')
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    )
    expect(sniffMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
    expect(
      sniffMime(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp')
  })

  it('认不出时返回 null，交给调用方处理', () => {
    expect(sniffMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull()
    expect(sniffMime(new Uint8Array([]))).toBeNull()
  })

  it('字节不足时不会越界读', () => {
    expect(sniffMime(new Uint8Array([0xff]))).toBeNull()
    expect(sniffMime(new Uint8Array([0x89, 0x50]))).toBeNull()
    // RIFF 头够长但缺 WEBP 标记
    expect(sniffMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull()
  })
})

describe('data URL 构造', () => {
  it('MIME 完全由调用方决定，不受来源影响', () => {
    expect(toDataUrl(new Uint8Array([1, 2, 3]), 'image/jpeg')).toBe('data:image/jpeg;base64,AQID')
  })

  it('拼出来的 data URL 能被 mimeOf 原样读回（回归：转码后类型不能丢）', () => {
    for (const mime of SUPPORTED_MIME) {
      const url = toDataUrl(new Uint8Array([1, 2, 3]), mime)
      expect(mimeOf(url)).toBe(mime)
      expect(() =>
        assertSupportedImages([
          { name: 'x', dataUrl: url, width: 10, height: 10, bytes: 3 },
        ]),
      ).not.toThrow()
    }
  })
})

describe('是否需要转码', () => {
  it('受支持且尺寸体积都合规时原样放行', () => {
    expect(needsNormalization(makeImage())).toBe(false)
    for (const mime of SUPPORTED_MIME) {
      expect(needsNormalization(makeImage({ dataUrl: `data:${mime};base64,AAAA` }))).toBe(false)
    }
  })

  it('长边超标要转码', () => {
    expect(needsNormalization(makeImage({ width: MAX_EDGE + 1, height: 100 }))).toBe(true)
    expect(needsNormalization(makeImage({ width: 100, height: MAX_EDGE + 1 }))).toBe(true)
    expect(needsNormalization(makeImage({ width: MAX_EDGE, height: MAX_EDGE }))).toBe(false)
  })

  it('体积超标要转码', () => {
    expect(needsNormalization(makeImage({ bytes: 3 * 1024 * 1024 }))).toBe(true)
  })

  it('源格式不受支持时也要转码 —— 这正是之前漏掉的那类', () => {
    for (const mime of ['image/avif', 'image/heic', 'image/bmp', 'image/tiff', 'image/svg+xml']) {
      expect(needsNormalization(makeImage({ dataUrl: `data:${mime};base64,AAAA` }))).toBe(true)
    }
    // 浏览器认不出类型时会退化成 octet-stream，同样必须转码
    expect(
      needsNormalization(makeImage({ dataUrl: 'data:application/octet-stream;base64,AAAA' })),
    ).toBe(true)
    expect(needsNormalization(makeImage({ dataUrl: 'data:;base64,AAAA' }))).toBe(true)
  })
})

describe('输出格式选择', () => {
  it('有透明通道用 PNG，否则用 JPEG', () => {
    expect(pickOutputType(true)).toBe('image/png')
    expect(pickOutputType(false)).toBe('image/jpeg')
  })
})

describe('发送前兜底校验', () => {
  it('四种受支持格式都放行', () => {
    expect(() =>
      assertSupportedImages([
        makeImage({ dataUrl: 'data:image/jpeg;base64,AAAA' }),
        makeImage({ dataUrl: 'data:image/png;base64,AAAA' }),
        makeImage({ dataUrl: 'data:image/webp;base64,AAAA' }),
        makeImage({ dataUrl: 'data:image/gif;base64,AAAA' }),
      ]),
    ).not.toThrow()
  })

  it('报错信息里要能看出是哪张图、什么类型', () => {
    expect(() =>
      assertSupportedImages([
        makeImage({ name: '来自手机的图.heic', dataUrl: 'data:image/heic;base64,AAAA' }),
      ]),
    ).toThrow(/来自手机的图\.heic.*image\/heic/s)
  })

  it('类型未知时给出可读的说明', () => {
    expect(() =>
      assertSupportedImages([makeImage({ dataUrl: 'data:;base64,AAAA' })]),
    ).toThrow(/未知/)
  })
})

describe('回归：Windows 缺失 .jpg MIME 注册项', () => {
  const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]
  const bytes = new Uint8Array(JPEG_HEAD)

  it('declared type 为空时按文件头识别为 JPEG，不做无谓重编码', () => {
    const declared = ''
    const mime = sniffMime(bytes) ?? declared
    const dataUrl = toDataUrl(bytes, mime)
    const image = { name: '_DSC4517.jpg', dataUrl, width: 1200, height: 800, bytes: 900_000 }

    expect(mimeOf(dataUrl)).toBe('image/jpeg')
    expect(needsNormalization(image)).toBe(false)
    expect(() => assertSupportedImages([image])).not.toThrow()
  })

  it('转码后类型不能丢 —— 这正是上一版漏掉的一步', () => {
    // 模拟 normalizeForUpload 的输出：显式指定编码格式
    const encoded = toDataUrl(new Uint8Array([1, 2, 3]), 'image/jpeg')
    expect(mimeOf(encoded)).toBe('image/jpeg')
    expect(
      needsNormalization({ dataUrl: encoded, width: 100, height: 100, bytes: 100 }),
    ).toBe(false)
  })

  it('真正不受支持的格式仍然要转码', () => {
    const heic = toDataUrl(new Uint8Array([0x00, 0x00, 0x00, 0x18]), 'image/heic')
    const image = { dataUrl: heic, width: 800, height: 600, bytes: 300_000 }
    expect(needsNormalization(image)).toBe(true)
    expect(() =>
      assertSupportedImages([{ name: 'a.heic', ...image }]),
    ).toThrow(/image\/heic/)
  })
})
