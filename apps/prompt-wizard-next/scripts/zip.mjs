/**
 * 极简 zip 写入器。
 *
 * 为什么不用系统工具：Windows 上的 tar 与 Compress-Archive 在写非 ASCII
 * 文件名时不会设置「UTF-8 文件名字段」标志位，解压方会按本地代码页解码，
 * 中文名直接变成 U+FFFD 乱码且不可恢复。自己写才能保证这个标志位正确。
 */
import { deflateRawSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS 时间戳格式：日期在高端 16 位，时间在低端 16 位。 */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  }
}

function walk(dir, base = '') {
  const entries = []
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name)
    const relative = base ? `${base}/${name}` : name
    const stat = statSync(full)
    if (stat.isDirectory()) {
      entries.push(...walk(full, relative))
    } else if (stat.isFile()) {
      entries.push({ relative, full, mtime: stat.mtime })
    }
  }
  return entries
}

/**
 * 把 sourceDir 打包成 zipPath。
 * @param {string} sourceDir 要打包的目录
 * @param {string} zipPath 输出的 zip 路径
 * @param {string} rootName zip 内的顶层目录名
 * @returns {number} 写出的字节数
 */
export function zipDirectory(sourceDir, zipPath, rootName) {
  const files = walk(sourceDir).map((entry) => ({
    ...entry,
    name: `${rootName}/${entry.relative}`,
  }))

  const chunks = []
  const central = []
  let offset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const raw = readFileSync(file.full)
    const compressed = deflateRawSync(raw, { level: 9 })
    const crc = crc32(raw)
    const { date, time } = dosDateTime(file.mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // 需要的解压版本
    // 0x0800 = 文件名使用 UTF-8
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBytes, compressed)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4) // 生成者版本
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(8, 10)
    header.writeUInt16LE(time, 12)
    header.writeUInt16LE(date, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    // << 在 JS 里是 32 位有符号运算，这里必须转回无符号
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38) // Unix 文件权限位
    header.writeUInt32LE(offset, 42)
    central.push(header, nameBytes)

    offset += local.length + nameBytes.length + compressed.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  const output = Buffer.concat([...chunks, centralBuffer, end])
  writeFileSync(zipPath, output)
  return output.length
}
