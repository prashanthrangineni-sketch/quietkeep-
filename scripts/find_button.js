import sharp from 'sharp';

async function run() {
  const imagePath = 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/55156320-d401-4517-9852-7f02e8648ea8/personal_notif_tapped.png';
  
  const { data, info } = await sharp(imagePath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  
  console.log(`Image size: ${width}x${height}`);

  // We are looking for the blue/purple button color.
  // In the CSS: linear-gradient(135deg,#5b5ef4,#818cf8) or background: var(--primary) which is #5b5ef4 or #6366f1.
  // Let's search for pixels where R is around 90-100, G is around 90-100, B is around 240-250 (RGB of #5b5ef4 is 91, 94, 244).
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let matchCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Check if it matches a bluish-purple color
      // #5b5ef4 is (91, 94, 244). #6366f1 is (99, 102, 241).
      if (r > 70 && r < 120 && g > 70 && g < 120 && b > 200) {
        matchCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (matchCount > 0) {
    console.log(`Found blue/purple pixels: ${matchCount}`);
    console.log(`Bounding box: X [${minX}, ${maxX}], Y [${minY}, ${maxY}]`);
    console.log(`Center: X = ${Math.round((minX + maxX) / 2)}, Y = ${Math.round((minY + maxY) / 2)}`);
  } else {
    console.log('No matching blue/purple pixels found');
  }
}

run().catch(console.error);
