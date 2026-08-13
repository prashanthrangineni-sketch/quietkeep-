// scripts/generate-favicon.mjs
//
// WHY THIS EXISTS
// ---------------
// /favicon.ico returns 404 on quietkeep.com. The repo ships public/favicon.png
// instead, but /favicon.ico is still the first path many crawlers and older
// browsers request, and nothing answers it.
//
// Note this is a NARROWER problem than the other Pranix products had. QuietKeep
// is already serving its correct mark — the purple face is what Google renders
// today, and public/icon-192.png / icon-512.png are genuine brand assets. So
// this script does not touch the artwork; it only fills the missing .ico.
//
// (There is an older scripts/generate-brand-icons.js in this repo, but it is not
// wired into any npm script — it was run by hand once. This one runs on every
// build via `prebuild`, so the .ico cannot silently disappear again.)

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const SOURCE = path.join(ROOT, 'public', 'icon-512.png')
const PUBLIC_DIR = path.join(ROOT, 'public')

function fail(msg) {
  console.error(`\n[favicon] FAILED: ${msg}\n`)
  process.exit(1)
}

async function resize(buf, size) {
  return sharp(buf)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * Minimal ICO container. Googlebot, Bingbot and every current browser accept
 * PNG frames inside an .ico, so the PNGs are embedded verbatim rather than
 * re-encoded as legacy BMP.
 */
function buildIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icon resource
  header.writeUInt16LE(frames.length, 4)

  const dir = Buffer.alloc(16 * frames.length)
  let offset = header.length + dir.length

  frames.forEach(({ size, buf }, i) => {
    const o = i * 16
    dir[o] = size >= 256 ? 0 : size // 0 encodes 256
    dir[o + 1] = size >= 256 ? 0 : size
    dir.writeUInt16LE(1, o + 4) // colour planes
    dir.writeUInt16LE(32, o + 6) // bits per pixel
    dir.writeUInt32LE(buf.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += buf.length
  })

  return Buffer.concat([header, dir, ...frames.map((f) => f.buf)])
}

async function main() {
  if (!existsSync(SOURCE)) fail(`missing ${SOURCE}`)

  const src = await readFile(SOURCE)
  const meta = await sharp(src).metadata()
  if (!meta.width || meta.width !== meta.height) {
    fail(`source is not square (${meta.width}x${meta.height}) — favicons must be square`)
  }
  console.log(`[favicon] source public/icon-512.png (${meta.width}x${meta.height})`)

  const frames = []
  for (const size of [16, 32, 48]) {
    frames.push({ size, buf: await resize(src, size) })
  }
  await writeFile(path.join(PUBLIC_DIR, 'favicon.ico'), buildIco(frames))
  console.log('[favicon] public/favicon.ico (16/32/48) — was 404')

  console.log('[favicon] done')
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)))
