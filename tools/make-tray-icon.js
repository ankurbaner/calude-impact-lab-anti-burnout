// Generates the tray icons. Run with `node tools/make-tray-icon.js` after
// changing the glyph; the PNGs it writes are committed to assets/.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

/** CRC32 over a buffer, as required by the PNG chunk format. */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Encode straight RGBA pixel data as a PNG buffer. */
const encodePng = (width, height, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const SIZE = 32;
const SS = 4; // supersampling factor, for anti-aliasing

/**
 * Coverage of the eye glyph at a point: an elliptical outline plus a pupil.
 * @returns 1 inside the ink, 0 outside.
 */
const inkAt = (x, y) => {
  const cx = x - SIZE / 2;
  const cy = y - SIZE / 2;
  const a = 14.0, b = 8.0, ring = 1.9;
  const outer = (cx / a) ** 2 + (cy / b) ** 2;
  const inner = (cx / (a - ring)) ** 2 + (cy / (b - ring)) ** 2;
  if (outer <= 1 && inner >= 1) return 1;          // the eye outline
  if (cx * cx + cy * cy <= 4.6 * 4.6) return 1;    // the pupil
  return 0;
};

/** Render the glyph in a single colour, anti-aliased via supersampling. */
const render = (r, g, b) => {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inkAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
        }
      }
      const i = (y * SIZE + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
      rgba[i + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  }
  return rgba;
};

const out = path.join(__dirname, "..", "assets");
// macOS renders a template image itself (black + alpha, inverted as needed).
fs.writeFileSync(path.join(out, "trayTemplate.png"), encodePng(SIZE, SIZE, render(0, 0, 0)));
// Windows/Linux taskbars are usually dark, so ship a light glyph there.
fs.writeFileSync(path.join(out, "tray-light.png"), encodePng(SIZE, SIZE, render(235, 238, 244)));
console.log("wrote assets/trayTemplate.png and assets/tray-light.png");
