import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireThat, WorkbenchError } from '../core/validation.mjs';

export const MAX_ASSET_BYTES = 30 * 1024 * 1024;
export const digest = data => crypto.createHash('sha256').update(data).digest('hex');

export function inside(root, relative) {
  requireThat(typeof relative === 'string' && /^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(relative), 'UNSAFE_PATH', '素材必须使用 assets/ 下的安全相对路径');
  const base = fs.realpathSync.native(root);
  // Check every existing prefix so Windows directory junctions are rejected even
  // when resolving a child through the junction later reports ENOENT.
  let prefix = base;
  for (const segment of relative.split('/')) {
    prefix = path.join(prefix, segment);
    let stat;
    try { stat = fs.lstatSync(prefix); } catch { break; }
    requireThat(!stat.isSymbolicLink(), 'UNSAFE_PATH', '素材路径不能经过符号链接或目录联接');
  }
  const file = fs.realpathSync.native(path.join(base, relative));
  requireThat(file.startsWith(base + path.sep), 'UNSAFE_PATH', '素材路径逃逸或符号链接指向包外');
  return file;
}

// Header/container validation only. Full image decoding belongs to the thumbnail pipeline.
export function imageInfo(data) {
  let mediaType, extension, width, height;
  if (data.length >= 45 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && data.toString('ascii', 12, 16) === 'IHDR' && data.toString('ascii', data.length - 8, data.length - 4) === 'IEND') {
    mediaType = 'image/png'; extension = 'png'; width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (data.length > 10 && data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) break;
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5);
        mediaType = 'image/jpeg'; extension = 'jpg'; break;
      }
      offset += length;
    }
  } else if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && data.readUInt32LE(4) + 8 === data.length) {
    const type = data.toString('ascii', 12, 16);
    if (type === 'VP8X') { width = data.readUIntLE(24, 3) + 1; height = data.readUIntLE(27, 3) + 1; }
    if (type === 'VP8 ' && data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) { width = data.readUInt16LE(26) & 0x3fff; height = data.readUInt16LE(28) & 0x3fff; }
    if (type === 'VP8L' && data[20] === 0x2f) { const bits = data.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
    if (width && height) { mediaType = 'image/webp'; extension = 'webp'; }
  }
  requireThat(mediaType && width > 0 && height > 0 && width * height <= 50000000, 'INVALID_IMAGE', '图片头/尺寸无效或像素超过 5000 万；仅接受 PNG、常规 JPEG、WebP');
  return { mediaType, extension, width, height, bytes: data.length, sha256: digest(data) };
}

export function readImage(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    requireThat(stat.isFile() && stat.size > 0 && stat.size <= MAX_ASSET_BYTES, 'ASSET_SIZE', '图片必须为 1 字节至 30 MiB 的普通文件');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const n = fs.readSync(fd, data, offset, data.length - offset, offset);
      requireThat(n > 0, 'ASSET_CHANGED', '读取过程中素材文件发生变化'); offset += n;
    }
    requireThat(fs.fstatSync(fd).size === stat.size, 'ASSET_CHANGED', '读取过程中素材文件发生变化');
    return { data, ...imageInfo(data) };
  } finally { fs.closeSync(fd); }
}

export function saveImage(root, image) {
  const relative = `assets/${image.sha256}.${image.extension}`;
  const assetDir = path.join(root, 'assets');
  fs.mkdirSync(assetDir, { recursive: true });
  requireThat(fs.realpathSync(assetDir) === path.join(fs.realpathSync(root), 'assets'), 'UNSAFE_PATH', '素材目录不能是外部符号链接');
  const file = path.join(root, relative);
  if (fs.existsSync(file)) {
    requireThat(digest(fs.readFileSync(inside(root, relative))) === image.sha256, 'ASSET_CORRUPTED', '已有素材被篡改；停止写入');
  } else {
    // Under the store's exclusive lock; a crash may leave an unreferenced immutable asset, never a partial final file.
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, image.data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireThat(digest(fs.readFileSync(file)) === image.sha256, 'ASSET_CORRUPTED', '并发写入后的素材哈希不符');
    } finally { fs.unlinkSync(temp); }
  }
  return { path: relative, mediaType: image.mediaType, width: image.width, height: image.height, bytes: image.bytes, sha256: image.sha256 };
}

export function findStoredImage(root, sha256) {
  requireThat(/^[a-f0-9]{64}$/.test(sha256 ?? ''), 'INVALID_UPLOAD', '素材标识无效');
  const matches = ['png', 'jpg', 'webp'].map(extension => `assets/${sha256}.${extension}`).filter(relative => fs.existsSync(path.join(root, relative)));
  requireThat(matches.length === 1, 'UPLOAD_NOT_FOUND', '找不到已上传素材，或素材类型存在冲突');
  const image = readImage(inside(root, matches[0]));
  requireThat(image.sha256 === sha256, 'ASSET_HASH_MISMATCH', '已上传素材哈希不符');
  return { ...image, path: matches[0] };
}

export function verifyAsset(root, ref) {
  let image;
  try { image = readImage(inside(root, ref.path)); } catch (error) {
    if (error instanceof WorkbenchError) throw error;
    throw new WorkbenchError('ASSET_MISSING', `无法读取素材 ${ref.assetId ?? ref.path}`);
  }
  for (const field of ['mediaType', 'width', 'height', 'bytes']) requireThat(image[field] === ref[field], 'ASSET_MISMATCH', `素材 ${ref.assetId ?? ref.path} 的 ${field} 不符`);
  if (ref.sha256 !== null) requireThat(image.sha256 === ref.sha256, 'ASSET_HASH_MISMATCH', '素材 SHA-256 不符');
  return image;
}
