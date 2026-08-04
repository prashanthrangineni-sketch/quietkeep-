// scripts/generate-brand-icons.js
// Generates official QuietKeep Personal (Violet) and Business (Emerald) smiley orb icons: (◕‿◕)
// Generated surfaces:
//  - Android launcher icons (personal & business flavors)
//  - PWA manifest icons (public/icon-192, public/icon-512, public/icon-business-192, public/icon-business-512)
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

// ── SVG Generators ─────────────────────────────────────────────────────────

function getSmileyOrbSvg(bg1, bg2, size, isRound = false) {
  const r = isRound ? size / 2 : Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.36);
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
    <text x="50%" y="52%" font-family="-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="central">(◕‿◕)</text>
  </svg>
  `;
}

function getForegroundSvg(bg1, bg2, size) {
  // Android Adaptive Icon Safe Zone: center 50% of 108dp viewport
  const innerSize = Math.round(size * 0.52);
  const offset = Math.round((size - innerSize) / 2);
  const r = Math.round(innerSize * 0.24);
  const fontSize = Math.round(innerSize * 0.36);
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <g transform="translate(${offset}, ${offset})">
      <rect width="${innerSize}" height="${innerSize}" rx="${r}" ry="${r}" fill="url(#bg)"/>
      <text x="50%" y="52%" font-family="-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="central">(◕‿◕)</text>
    </g>
  </svg>
  `;
}

// ── Build Generator ────────────────────────────────────────────────────────

async function generateFlavorIcons(flavor, bg1, bg2, targetResDir) {
  console.log(`Generating Android icons for flavor: ${flavor} -> ${targetResDir}`);

  for (const [folder, s] of Object.entries(sizes)) {
    const dir = path.join(targetResDir, folder);
    fs.mkdirSync(dir, { recursive: true });

    // ic_launcher.png
    const iconSvg = getSmileyOrbSvg(bg1, bg2, s.icon, false);
    await sharp(Buffer.from(iconSvg)).png().toFile(path.join(dir, 'ic_launcher.png'));

    // ic_launcher_round.png
    const roundSvg = getSmileyOrbSvg(bg1, bg2, s.icon, true);
    await sharp(Buffer.from(roundSvg)).png().toFile(path.join(dir, 'ic_launcher_round.png'));

    // ic_launcher_foreground.png
    const fgSvg = getForegroundSvg(bg1, bg2, s.foreground);
    await sharp(Buffer.from(fgSvg)).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
}

async function generatePwaAndWebAssets() {
  console.log('Generating PWA Manifest icons & Web Favicons...');
  const publicDir = path.join(__dirname, '..', 'public');

  // Personal PWA icons (Violet)
  await sharp(Buffer.from(getSmileyOrbSvg('#5b5ef4', '#8b5cf6', 192, false))).png().toFile(path.join(publicDir, 'icon-192.png'));
  await sharp(Buffer.from(getSmileyOrbSvg('#5b5ef4', '#8b5cf6', 512, false))).png().toFile(path.join(publicDir, 'icon-512.png'));

  // Business PWA icons (Emerald)
  await sharp(Buffer.from(getSmileyOrbSvg('#10b981', '#059669', 192, false))).png().toFile(path.join(publicDir, 'icon-business-192.png'));
  await sharp(Buffer.from(getSmileyOrbSvg('#10b981', '#059669', 512, false))).png().toFile(path.join(publicDir, 'icon-business-512.png'));

  // Web Favicon & Apple Touch Icon
  await sharp(Buffer.from(getSmileyOrbSvg('#5b5ef4', '#8b5cf6', 180, false))).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
  await sharp(Buffer.from(getSmileyOrbSvg('#5b5ef4', '#8b5cf6', 64, false))).png().toFile(path.join(publicDir, 'favicon.png'));

  console.log('✓ PWA icons and favicons regenerated cleanly');
}

async function main() {
  const baseRes = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
  const personalRes = path.join(__dirname, '..', 'android', 'app', 'src', 'personal', 'res');
  const businessRes = path.join(__dirname, '..', 'android', 'app', 'src', 'business', 'res');

  // Personal: Smiley Orb (Violet)
  await generateFlavorIcons('personal', '#5b5ef4', '#8b5cf6', baseRes);
  await generateFlavorIcons('personal', '#5b5ef4', '#8b5cf6', personalRes);

  // Business: Smiley Orb (Emerald)
  await generateFlavorIcons('business', '#10b981', '#059669', businessRes);

  // PWA and Web Favicons
  await generatePwaAndWebAssets();

  console.log('✅ ALL brand assets (Android, PWA, Web Favicons) regenerated from (◕‿◕) smiley orb!');
}

main().catch(err => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
