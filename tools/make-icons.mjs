#!/usr/bin/env node
/**
 * Erzeugt die App-Icons: ein stilisierter Bierkasten (abgerundetes Quadrat in
 * Cognac mit 3×2 Flaschenöffnungen).
 *
 * Schreibt die PNGs von Hand — ein PNG ist nur eine Handvoll Chunks mit
 * zlib-komprimierten Bildzeilen, und zlib bringt Node schon mit. So bleibt es
 * bei null zusätzlichen Abhängigkeiten für drei Bilder, die sich nie ändern.
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const BG = [138, 79, 13]; // #8a4f0d — Cognac, wie der Primärbutton
const CRATE = [250, 247, 242]; // #faf7f2 — Cremeweiß, wie der Seitenhintergrund
const HOLE = [90, 50, 8]; // dunklere Öffnungen

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** @param {number} size @param {(x:number,y:number)=>number[]} shade */
function png(size, shade) {
  // Bildzeilen im Format "Filterbyte 0, dann RGB pro Pixel".
  const raw = Buffer.alloc(size * (1 + size * 3));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = shade(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 Bit pro Kanal
  ihdr[9] = 2; // Truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Zeichnet das Motiv für eine Kantenlänge. */
function crateIcon(size) {
  const u = size / 100; // damit sich alles in Prozent der Kantenlänge rechnet
  const crate = { x0: 18 * u, y0: 24 * u, x1: 82 * u, y1: 76 * u };
  const wall = 7 * u;
  const holeR = 7.5 * u;

  // 3×2 Öffnungen, gleichmäßig in der Innenfläche verteilt
  const holes = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      holes.push({
        cx: crate.x0 + wall + ((col + 0.5) * (crate.x1 - crate.x0 - 2 * wall)) / 3,
        cy: crate.y0 + wall + ((row + 0.5) * (crate.y1 - crate.y0 - 2 * wall)) / 2,
      });
    }
  }

  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;

    const inCrate = px >= crate.x0 && px <= crate.x1 && py >= crate.y0 && py <= crate.y1;
    if (!inCrate) return BG;

    for (const hole of holes) {
      if ((px - hole.cx) ** 2 + (py - hole.cy) ** 2 <= holeR ** 2) return HOLE;
    }
    return CRATE;
  };
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(resolve(outDir, name), png(size, crateIcon(size)));
  console.log(`public/${name} (${size}×${size})`);
}
