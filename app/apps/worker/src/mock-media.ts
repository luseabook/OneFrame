import { deflateSync } from "node:zlib";

/**
 * mock 模式下的**图片占位产物**：生成一张真实可渲染的小 PNG（而非写文本到 `.png`）。
 *
 * 为什么必须给真图：
 * 图片工具页把产物直接塞进 `<img src>`。以前 mock 写的是 43 字节的文本
 * （`mock result for task ...`），浏览器解码失败 → 页面显示**裂图**；
 * 而"裂图"和"生成失败"在界面上几乎无法区分，会让人误判功能坏了
 * （这个教训与 mock 适配器里"给图片任务返回 .mp4"是同一类）。
 *
 * 实现：纯 Node 生成 PNG（IHDR/IDAT/IEND + CRC32），不依赖 canvas/native 库；
 * 颜色由 taskId+index 派生（同一任务重跑稳定，不同任务能看出差异），便于人工核对"是不是新产物"。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/** 确定性颜色：同一 (seed) 永远同色，便于测试断言 */
function colorOf(seed: string): { r: number; g: number; b: number } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return { r: (hash >> 16) & 0xff, g: (hash >> 8) & 0xff, b: hash & 0xff };
}

/**
 * 生成 `size × size` 的纯色 PNG，中央画一个对角条纹以便肉眼确认"不是缓存旧图"。
 * `size` 默认 64（几百字节，足够小，也不至于在结果区显示成一个点）。
 */
export function mockPngBuffer(seed: string, size = 64): Buffer {
  const { r, g, b } = colorOf(seed);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      // 45° 条纹：让图片有可见纹理，便于确认产物确实变了
      const stripe = (x + y) % 16 < 8;
      raw[offset] = stripe ? r : Math.min(255, r + 40);
      raw[offset + 1] = stripe ? g : Math.min(255, g + 40);
      raw[offset + 2] = stripe ? b : Math.min(255, b + 40);
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
