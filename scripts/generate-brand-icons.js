// scripts/generate-brand-icons.js
// Generates official Personal (QK) and Business (QB) launcher icons using sharp
// Safe zone: inner ~50% of 108dp canvas (fits well within Android's 66dp / 61% safe circle)

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

function getIconSvg(text, bg1, bg2, size, isRound = false) {
  const r = isRound ? size / 2 : Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.38);
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
    <text x="50%" y="54%" font-family="Inter, system-ui, sans-serif" font-weight="900" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${text}</text>
  </svg>
  `;
}

function getForegroundSvg(text, bg1, bg2, size) {
  // Android Adaptive Icon Safe Zone: center 66dp of 108dp canvas (61%).
  // Using 50% inner size ensures generous padding and 0% clipping on all launcher masks.
  const innerSize = Math.round(size * 0.50);
  const offset = Math.round((size - innerSize) / 2);
  const r = Math.round(innerSize * 0.24);
  const fontSize = Math.round(innerSize * 0.38);
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
      <text x="50%" y="54%" font-family="Inter, system-ui, sans-serif" font-weight="900" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${text}</text>
    </g>
  </svg>
  `;
}

// ── Build Generator ────────────────────────────────────────────────────────

async function generateFlavorIcons(flavor, text, bg1, bg2, targetResDir) {
  console.log(`Generating icons for flavor: ${flavor} -> ${targetResDir}`);

  for (const [folder, s] of Object.entries(sizes)) {
    const dir = path.join(targetResDir, folder);
    fs.mkdirSync(dir, { recursive: true });

    // ic_launcher.png
    const iconSvg = getIconSvg(text, bg1, bg2, s.icon, false);
    await sharp(Buffer.from(iconSvg)).png().toFile(path.join(dir, 'ic_launcher.png'));

    // ic_launcher_round.png
    const roundSvg = getIconSvg(text, bg1, bg2, s.icon, true);
    await sharp(Buffer.from(roundSvg)).png().toFile(path.join(dir, 'ic_launcher_round.png'));

    // ic_launcher_foreground.png
    const fgSvg = getForegroundSvg(text, bg1, bg2, s.foreground);
    await sharp(Buffer.from(fgSvg)).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
}

async function main() {
  const baseRes = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
  const personalRes = path.join(__dirname, '..', 'android', 'app', 'src', 'personal', 'res');
  const businessRes = path.join(__dirname, '..', 'android', 'app', 'src', 'business', 'res');

  // Personal: QK (Purple)
  await generateFlavorIcons('personal', 'QK', '#5b5ef4', '#8b5cf6', baseRes);
  await generateFlavorIcons('personal', 'QK', '#5b5ef4', '#8b5cf6', personalRes);

  // Business: QB (Emerald)
  await generateFlavorIcons('business', 'QB', '#10b981', '#059669', businessRes);

  console.log('✅ All launcher icons regenerated cleanly inside 50% safe zone!');
}

main().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
