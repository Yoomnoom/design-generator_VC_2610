import zlib from "node:zlib";
import { RawImage } from "@/lib/image/raw-image";

/** Minimal PNG reader for test fixtures: 8-bit RGB or RGBA, non-interlaced, all five row filters. */
export function decodePng(file: Buffer): RawImage {
  if (file.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0, height = 0, colorType = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString("ascii", at + 4, at + 8);
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNGs are supported");
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    at += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels] : 0;
      const predictor =
        filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : (() => {
          const p = left + up - upLeft;
          const [pl, pu, pul] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
          return pl <= pu && pl <= pul ? left : pu <= pul ? up : upLeft;
        })();
      rows[y * stride + x] = (v + predictor) & 255;
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rows[i * channels];
    data[i * 4 + 1] = rows[i * channels + 1];
    data[i * 4 + 2] = rows[i * channels + 2];
    data[i * 4 + 3] = channels === 4 ? rows[i * channels + 3] : 255;
  }
  return { width, height, data };
}
