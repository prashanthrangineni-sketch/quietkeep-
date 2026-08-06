// scripts/generate-brand-icons.js
// Generates official QuietKeep Personal (Violet) and Business (Emerald) smiley orb icons.
// The face is drawn with REAL SVG vector shapes (two oval eyes + a quadratic smile),
// NOT the text glyph "(◕‿◕)" — text glyphs depend on a system font that is missing on
// most build machines (U+25D5 ◕, U+203F ‿), which produced the broken/clipped icon.
//
// Icons are solid brand-colour to match the adaptive-icon background colour exactly,
// so the launcher icon is identical to the Play Store listing icon (no mismatch).
//
// Generated surfaces:
//  - Android launcher icons (main + personal + business flavors)
//  - PWA manifest icons (public/icon-192, icon-512, icon-business-192, icon-business-512)
//  - Web favicons (public/favicon.png, public/apple-touch-icon.png)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sizes = {
  'mipmap-mdpi': { icon: 48, foreground: 108 },
  'mipmap-hdpi': { icon: 72, foreground: 162 },
  'mipmap-xhdpi': { icon: 96, foreground: 216 },
  'mipmap-xxhdpi': { icon: 144, foreground: 324 },
  'mipmap-xxxhdpi': { icon: 192, foreground: 432 },
};

const PERSONAL_BG = '#5b5ef4';
const BUSINESS_BG = '#10b981';

// ── SVG Generators (pure vector face — no fonts) ────────────────────────────

// Full icon: solid brand-colour squircle (or circle) + white drawn smiley.
function getSmileyOrbSvg(bg, size, isRound = false) {
  const r = isRound ? size / 2 : Math.round(size * 0.22);
  const cx = size / 2, cy = size / 2;
  const eyeRX = size * 0.060, eyeRY = size * 0.088;
  const eyeDX = size * 0.150, eyeY = cy - size * 0.075;
  const sx = size * 0.150, sy = size * 0.055, cdepth = size * 0.19;
  const sw = Math.max(2, size * 0.056);
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${bg}"/>
    <ellipse cx="${cx - eyeDX}" cy="${eyeY}" rx="${eyeRX}" ry="${eyeRY}" fill="#ffffff"/>
    <ellipse cx="${cx + eyeDX}" cy="${eyeY}" rx="${eyeRX}" ry="${eyeRY}" fill="#ffffff"/>
    <path d="M ${cx - sx} ${cy + sy} Q ${cx} ${cy + cdepth} ${cx + sx} ${cy + sy}" fill="none" stroke="#ffffff" stroke-width="${sw}" stroke-linecap="round"/>
  </svg>
  `;
}

// Adaptive foreground: white face ONLY on transparent bg, sized inside the centre
// safe-zone so no launcher mask clips it (background colour is supplied by the
// adaptive-icon @color/ic_launcher_background layer).
function getForegroundSvg(size) {
  const inner = Math.round(size * 0.62);
  const off = Math.round((size - inner) / 2);
  const cx = inner / 2, cy = inner / 2;
  const eyeRX = inner * 0.070, eyeRY = inner * 0.10;
  const eyeDX = inner * 0.175, eyeY = cy - inner * 0.085;
  const sx = inner * 0.175, sy = inner * 0.06, cdepth = inner * 0.22;
  const sw = Math.max(2, inner * 0.065);
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(${off}, ${off})">
      <ellipse cx="${cx - eyeDX}" cy="${eyeY}" rx="${eyeRX}" ry="${eyeRY}" fill="#ffffff"/>
      <ellipse cx="${cx + eyeDX}" cy="${eyeY}" rx="${eyeRX}" ry="${eyeRY}" fill="#ffffff"/>
      <path d="M ${cx - sx} ${cy + sy} Q ${cx} ${cy + cdepth} ${cx + sx} ${cy + sy}" fill="none" stroke="#ffffff" stroke-width="${sw}" stroke-linecap="round"/>
    </g>
  </svg>
  `;
}

// ── Build Generator ────────────────────────────────────────────────────────

async function generateFlavorIcons(flavor, bg, targetResDir) {
  console.log(`Generating Android icons for flavor: ${flavor} -> ${targetResDir}`);
  for (const [folder, s] of Object.entries(sizes)) {
    const dir = path.join(targetResDir, folder);
    fs.mkdirSync(dir, { recursive: true });

    await sharp(Buffer.from(getSmileyOrbSvg(bg, s.icon, false))).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(Buffer.from(getSmileyOrbSvg(bg, s.icon, true))).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    await sharp(Buffer.from(getForegroundSvg(s.foreground))).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
}

async function generatePwaAndWebAssets() {
  console.log('Generating PWA Manifest icons & Web Favicons...');
  const publicDir = path.join(__dirname, '..', 'public');

  await sharp(Buffer.from(getSmileyOrbSvg(PERSONAL_BG, 192))).png().toFile(path.join(publicDir, 'icon-192.png'));
  await sharp(Buffer.from(getSmileyOrbSvg(PERSONAL_BG, 512))).png().toFile(path.join(publicDir, 'icon-512.png'));

  await sharp(Buffer.from(getSmileyOrbSvg(BUSINESS_BG, 192))).png().toFile(path.join(publicDir, 'icon-business-192.png'));
  await sharp(Buffer.from(getSmileyOrbSvg(BUSINESS_BG, 512))).png().toFile(path.join(publicDir, 'icon-business-512.png'));

  await sharp(Buffer.from(getSmileyOrbSvg(PERSONAL_BG, 180))).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
  await sharp(Buffer.from(getSmileyOrbSvg(PERSONAL_BG, 64))).png().toFile(path.join(publicDir, 'favicon.png'));

  console.log('✓ PWA icons and favicons regenerated cleanly');
}

async function main() {
  const baseRes = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
  const personalRes = path.join(__dirname, '..', 'android', 'app', 'src', 'personal', 'res');
  const businessRes = path.join(__dirname, '..', 'android', 'app', 'src', 'business', 'res');

  await generateFlavorIcons('personal', PERSONAL_BG, baseRes);
  await generateFlavorIcons('personal', PERSONAL_BG, personalRes);
  await generateFlavorIcons('business', BUSINESS_BG, businessRes);

  await generatePwaAndWebAssets();

  console.log('✅ ALL brand assets regenerated from drawn smiley orb (no font glyphs).');
}

main().catch(err => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
