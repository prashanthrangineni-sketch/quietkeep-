#!/usr/bin/env node
// scripts/vision/make-fixtures.mjs
//
// Renders ~40 SYNTHETIC test images of Indian bills, receipts, and product labels
// using Playwright/Chromium from HTML templates, each with a matching ground-truth JSON:
//   tests/fixtures/vision/<id>.png + <id>.json
//
// Document types:
//   - kirana bill (Telugu, Hindi, English, mixed)
//   - pharmacy bill (medicine names, MRP, batch, expiry)
//   - restaurant bill (items, GST lines, total)
//   - electricity/utility bill (consumer no., amount due, due date)
//   - packaged product label (brand, product, MRP, net quantity, mfg date, best-before/expiry)
//
// Visual variations:
//   - clean / standard
//   - slight rotation
//   - subtle blur
//   - low contrast / washed out
//   - faded thermal look
//   - phone-photo shadow overlay
//
// Every image and record is 100% synthetic: fake shops, fake names, fake GSTINs.

import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = join(here, '..', '..')
const fixturesDir = join(rootDir, 'tests', 'fixtures', 'vision')
mkdirSync(fixturesDir, { recursive: true })

// ── Chromium / Playwright locator ───────────────────────────────────────────
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean)

  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

async function renderHtmlToPng(html, outPngPath, width = 640, height = 800) {
  // Check if playwright is available
  try {
    const pw = await import('playwright')
    if (pw && pw.chromium) {
      const browser = await pw.chromium.launch({ headless: true })
      const page = await browser.newPage({ viewport: { width, height } })
      await page.setContent(html, { waitUntil: 'load' })
      await page.screenshot({ path: outPngPath, fullPage: true })
      await browser.close()
      return
    }
  } catch {
    // Fall back to direct Chromium invocation
  }

  const chromePath = findChromium()
  if (!chromePath) {
    throw new Error('Chromium executable not found. Please set CHROMIUM_PATH or install Playwright.')
  }

  const tmpHtml = join(fixturesDir, `_temp_${Date.now()}_${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(tmpHtml, html, 'utf8')
  try {
    const fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/')
    const args = [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--screenshot=${outPngPath}`,
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      fileUrl,
    ]
    const res = spawnSync(chromePath, args)
    if (res.status !== 0 && !existsSync(outPngPath)) {
      throw new Error(`Chromium screenshot failed: ${res.stderr?.toString() || 'status ' + res.status}`)
    }
  } finally {
    if (existsSync(tmpHtml)) unlinkSync(tmpHtml)
  }
}

// ── HTML Template Generators ────────────────────────────────────────────────
function wrapPage(innerHtml, variation = 'clean', width = 420) {
  let styleFilter = ''
  let styleTransform = ''
  let shadowOverlay = ''
  let bgOuter = '#f4f4f6'
  let bgPaper = '#ffffff'
  let fontColor = '#1a1a1a'

  if (variation === 'rotation') {
    styleTransform = 'transform: rotate(1.8deg); margin: 30px auto;'
    bgOuter = '#dcd7cf'
  } else if (variation === 'blur') {
    styleFilter = 'filter: blur(0.7px);'
  } else if (variation === 'low_contrast') {
    styleFilter = 'filter: contrast(0.68) brightness(1.05);'
    fontColor = '#3a3a3a'
  } else if (variation === 'thermal_faded') {
    fontColor = '#52504c'
    bgPaper = '#fdfaf2'
    styleFilter = 'filter: contrast(0.85);'
  } else if (variation === 'phone_shadow') {
    shadowOverlay = `
      <div style="position: absolute; inset: 0; pointer-events: none; border-radius: 6px;
        background: linear-gradient(135deg, rgba(15,15,20,0.45) 0%, rgba(20,20,25,0.18) 45%, rgba(0,0,0,0) 80%);">
      </div>
    `
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: ${bgOuter};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Telugu", "Noto Sans Devanagari", sans-serif;
      color: ${fontColor};
      display: flex;
      justify-content: center;
      padding: 24px 16px;
    }
    .bill-card {
      position: relative;
      background: ${bgPaper};
      width: ${width}px;
      padding: 24px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.10);
      border-radius: 4px;
      ${styleTransform}
      ${styleFilter}
    }
    .dashed { border-top: 1px dashed #bbb; margin: 12px 0; }
    .table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    .table th { text-align: left; padding: 6px 4px; border-bottom: 1px solid #ddd; }
    .table td { padding: 6px 4px; border-bottom: 1px dotted #eee; }
    .table .r { text-align: right; }
    .bold { font-weight: bold; }
    .center { text-align: center; }
    .small { font-size: 11px; color: #666; }
    .tag { display: inline-block; padding: 2px 6px; background: #eee; border-radius: 3px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="bill-card">
    ${innerHtml}
    ${shadowOverlay}
  </div>
</body>
</html>`
}

function renderKiranaHtml(data) {
  const itemRows = data.items.map((it) => `
    <tr>
      <td>${it.name}</td>
      <td class="r">${it.qty || '1'}</td>
      <td class="r">₹${it.price}</td>
    </tr>
  `).join('')

  const inner = `
    <div class="center">
      <h2 style="font-size: 18px; margin-bottom: 4px;">${data.merchant}</h2>
      <div class="small">KIRANA & PROVISION MERCHANTS</div>
      <div class="small">Plot 42, Market Road, Sample Nagar, TG 500000</div>
      <div class="small">Ph: +91 90000 00000 | GSTIN: ${data.gstin || '36AAAAA0000A1Z5'}</div>
    </div>
    <div class="dashed"></div>
    <div style="display: flex; justify-content: space-between; font-size: 12px;">
      <span>Bill No: #KR-${data.id.slice(-4)}</span>
      <span>Date: ${data.date}</span>
    </div>
    <div class="dashed"></div>
    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th class="r">Qty</th>
          <th class="r">Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    <div class="dashed"></div>
    <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; padding: 6px 0;">
      <span>TOTAL</span>
      <span>₹${data.total}</span>
    </div>
    <div class="dashed"></div>
    <div class="center small" style="margin-top: 10px;">
      ధన్యవాదములు • धन्यवाद • Thank You Visit Again!
    </div>
  `
  return wrapPage(inner, data.variation, 380)
}

function renderPharmacyHtml(data) {
  const itemRows = data.items.map((it) => `
    <tr>
      <td>
        <div class="bold">${it.name}</div>
        <div class="small">Batch: ${data.batch || 'BTH-8821'} | Exp: ${data.expiry || '2027-12'}</div>
      </td>
      <td class="r">${it.qty || '1'}</td>
      <td class="r">₹${it.price}</td>
    </tr>
  `).join('')

  const inner = `
    <div class="center">
      <div class="tag" style="background: #e8f5e9; color: #2e7d32; font-weight: bold; margin-bottom: 4px;">RETAIL PHARMACY TAX INVOICE</div>
      <h2 style="font-size: 19px; color: #1b5e20;">${data.merchant}</h2>
      <div class="small">D.L. No: TG-HYD-000000 | GSTIN: ${data.gstin || '36AAAAA0000A1Z5'}</div>
      <div class="small">Ph: +91 90000 00000 | 24x7 Healthcare Services</div>
    </div>
    <div class="dashed"></div>
    <div style="display: flex; justify-content: space-between; font-size: 12px;">
      <span>Patient: Sample Patient</span>
      <span>Date: ${data.date}</span>
    </div>
    <div class="dashed"></div>
    <table class="table">
      <thead>
        <tr>
          <th>Description</th>
          <th class="r">Qty</th>
          <th class="r">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    <div class="dashed"></div>
    <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
      <span>Total MRP:</span>
      <span>₹${data.mrp || data.total}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: bold;">
      <span>NET AMOUNT PAYABLE</span>
      <span>₹${data.total}</span>
    </div>
    <div class="dashed"></div>
    <div class="center small" style="color: #c62828;">
      Schedule H / H1 Drug Warning: To be sold by retail on prescription only.
    </div>
  `
  return wrapPage(inner, data.variation, 420)
}

function renderRestaurantHtml(data) {
  const itemRows = data.items.map((it) => `
    <tr>
      <td>${it.name}</td>
      <td class="r">${it.qty || '1'}</td>
      <td class="r">₹${it.price}</td>
    </tr>
  `).join('')

  const subtotal = data.items.reduce((s, it) => s + Number(it.price || 0), 0)
  const gstAmt = Math.round((data.total - subtotal) / 2)

  const inner = `
    <div class="center">
      <h2 style="font-size: 20px; font-family: Georgia, serif;">${data.merchant}</h2>
      <div class="small">Family Restaurant & Pure Vegetarian Tiffins</div>
      <div class="small">GSTIN: ${data.gstin || '36AAAAA0000A1Z5'} | FSSAI: 10000000000000</div>
    </div>
    <div class="dashed"></div>
    <div style="display: flex; justify-content: space-between; font-size: 12px;">
      <span>Table: T-12 | Waiter: Sample</span>
      <span>Date: ${data.date}</span>
    </div>
    <div class="dashed"></div>
    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th class="r">Qty</th>
          <th class="r">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    <div class="dashed"></div>
    <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 2px;">
      <span>Sub Total:</span>
      <span>₹${subtotal}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-bottom: 2px;">
      <span>CGST 2.5%:</span>
      <span>₹${gstAmt}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-bottom: 6px;">
      <span>SGST 2.5%:</span>
      <span>₹${gstAmt}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: bold;">
      <span>GRAND TOTAL</span>
      <span>₹${data.total}</span>
    </div>
    <div class="dashed"></div>
    <div class="center small">Thank you for dining with us!</div>
  `
  return wrapPage(inner, data.variation, 370)
}

function renderUtilityHtml(data) {
  const inner = `
    <div style="border: 2px solid #1565c0; padding: 14px; border-radius: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1565c0; padding-bottom: 8px;">
        <div>
          <h2 style="font-size: 18px; color: #0d47a1;">${data.merchant}</h2>
          <div class="small">ELECTRICITY CONSUMPTION BILL / HT/LT TARIFF</div>
        </div>
        <div class="tag" style="background: #e3f2fd; color: #0d47a1; font-weight: bold;">OFFICIAL BILL</div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; font-size: 12px;">
        <div>
          <div class="small">Consumer Number:</div>
          <div class="bold" style="font-size: 14px;">${data.consumer_no || 'TG-000000000'}</div>
        </div>
        <div>
          <div class="small">Bill Date:</div>
          <div class="bold">${data.date}</div>
        </div>
        <div>
          <div class="small">Billing Category:</div>
          <div>Domestic (LT-1B)</div>
        </div>
        <div>
          <div class="small">Due Date:</div>
          <div class="bold" style="color: #c62828;">${data.due_date || data.date}</div>
        </div>
      </div>
      <div class="dashed"></div>
      <div style="font-size: 13px; line-height: 1.6;">
        <div style="display: flex; justify-content: space-between;">
          <span>Energy Consumption Charges:</span>
          <span>₹${data.total - 120}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Customer & Meter Charges:</span>
          <span>₹120</span>
        </div>
      </div>
      <div style="margin-top: 14px; background: #fff3e0; border: 1px solid #ffe0b2; padding: 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div class="small" style="color: #e65100; font-weight: bold;">TOTAL AMOUNT PAYABLE</div>
          <div style="font-size: 11px; color: #666;">Pay before due date to avoid disconnect</div>
        </div>
        <div style="font-size: 20px; font-weight: bold; color: #bf360c;">
          ₹${data.total}
        </div>
      </div>
    </div>
  `
  return wrapPage(inner, data.variation, 460)
}

function renderProductLabelHtml(data) {
  const item = data.items[0] || { name: 'Food Product', qty: '500g', price: data.total }
  const inner = `
    <div style="border: 2px solid #37474f; border-radius: 6px; overflow: hidden;">
      <div style="background: #2e7d32; color: #fff; padding: 10px 14px; text-align: center;">
        <div style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase;">100% PURE & NATURAL</div>
        <h2 style="font-size: 20px; margin-top: 2px;">${data.merchant}</h2>
      </div>
      <div style="padding: 16px;">
        <h3 style="font-size: 17px; color: #1b5e20; margin-bottom: 6px;">${item.name}</h3>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px;">
          <span>Net Quantity: <span class="bold">${item.qty || '500 ml'}</span></span>
          <span class="tag" style="background: #e8f5e9; color: #2e7d32;">Grade A</span>
        </div>
        <div class="dashed"></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; margin-bottom: 10px;">
          <div>
            <span class="small">Batch No:</span>
            <div class="bold">B-${data.id.slice(-4).toUpperCase()}</div>
          </div>
          <div>
            <span class="small">Mfg Date:</span>
            <div class="bold">${data.date}</div>
          </div>
          <div>
            <span class="small">Best Before / Expiry:</span>
            <div class="bold" style="color: #c62828;">${data.expiry || '12 Months from Mfg'}</div>
          </div>
          <div>
            <span class="small">FSSAI Lic No:</span>
            <div>10000000000000</div>
          </div>
        </div>
        <div class="dashed"></div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px;">
          <div>
            <div class="small">Maximum Retail Price:</div>
            <div style="font-size: 11px; color: #777;">(Inclusive of all taxes)</div>
          </div>
          <div style="font-size: 22px; font-weight: bold; color: #1b5e20;">
            ₹${data.mrp || data.total}
          </div>
        </div>
      </div>
    </div>
  `
  return wrapPage(inner, data.variation, 390)
}

function generateHtml(fixture) {
  switch (fixture.doc_type) {
    case 'kirana':
      return renderKiranaHtml(fixture)
    case 'pharmacy':
      return renderPharmacyHtml(fixture)
    case 'restaurant':
      return renderRestaurantHtml(fixture)
    case 'utility':
      return renderUtilityHtml(fixture)
    case 'product_label':
      return renderProductLabelHtml(fixture)
    default:
      return renderKiranaHtml(fixture)
  }
}

// ── 40 Synthetic Test Cases ─────────────────────────────────────────────────
export const FIXTURES = [
  // ── Kirana Bills (10) ─────────────────────────────────────────────────────
  {
    id: 'kirana_te_01', synthetic: true, doc_type: 'kirana', script: 'telugu', variation: 'clean',
    merchant: 'శ్రీ వేంకటేశ్వర కిరాణా జనరల్ స్టోర్స్', date: '2026-10-18', total: 485, currency: 'INR',
    items: [
      { name: 'సోనా మసూరి బియ్యం', qty: '5 kg', price: 320 },
      { name: 'కందిపప్పు', qty: '1 kg', price: 165 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'kirana_te_02', synthetic: true, doc_type: 'kirana', script: 'telugu', variation: 'thermal_faded',
    merchant: 'లక్ష్మి ట్రేడర్స్ కిరాణా', date: '2026-10-20', total: 340, currency: 'INR',
    items: [
      { name: 'వేరుశనగ గుళ్ళు', qty: '1 kg', price: 180 },
      { name: 'పంచదార', qty: '2 kg', price: 90 },
      { name: 'టీ పొడి', qty: '250 g', price: 70 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'kirana_te_03', synthetic: true, doc_type: 'kirana', script: 'telugu', variation: 'phone_shadow',
    merchant: 'రైతు బజార్ ప్రొవిజన్స్', date: '2026-10-22', total: 610, currency: 'INR',
    items: [
      { name: 'సన్ ఫ్లవర్ నూనె', qty: '2 L', price: 290 },
      { name: 'గోధుమ పిండి', qty: '5 kg', price: 240 },
      { name: 'ఉప్పు ప్యాకెట్', qty: '2 pcs', price: 40 },
      { name: 'పసుపు', qty: '200 g', price: 40 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'kirana_hi_01', synthetic: true, doc_type: 'kirana', script: 'hindi', variation: 'clean',
    merchant: 'श्री गणेश किराना स्टोर', date: '2026-10-15', total: 530, currency: 'INR',
    items: [
      { name: 'बासमती चावल', qty: '2 kg', price: 220 },
      { name: 'अरहर दाल', qty: '1 kg', price: 170 },
      { name: 'सरसों का तेल', qty: '1 L', price: 140 },
    ],
    mrp: null, expiry: null, gstin: '23AAAAA0000A1Z2',
  },
  {
    id: 'kirana_hi_02', synthetic: true, doc_type: 'kirana', script: 'hindi', variation: 'low_contrast',
    merchant: 'अग्रवाल प्रोविजन स्टोर', date: '2026-10-19', total: 275, currency: 'INR',
    items: [
      { name: 'राजमा चित्रा', qty: '1 kg', price: 145 },
      { name: 'सफेद चना', qty: '1 kg', price: 130 },
    ],
    mrp: null, expiry: null, gstin: '07AAAAA0000A1Z8',
  },
  {
    id: 'kirana_hi_03', synthetic: true, doc_type: 'kirana', script: 'hindi', variation: 'rotation',
    merchant: 'किसान सेवा किराना भंडार', date: '2026-10-21', total: 460, currency: 'INR',
    items: [
      { name: 'सूजी रवा', qty: '1 kg', price: 50 },
      { name: 'मैदा', qty: '1 kg', price: 45 },
      { name: 'देसी घी', qty: '500 g', price: 365 },
    ],
    mrp: null, expiry: null, gstin: '09AAAAA0000A1Z3',
  },
  {
    id: 'kirana_en_01', synthetic: true, doc_type: 'kirana', script: 'english', variation: 'clean',
    merchant: 'Bharat Super Kirana Store', date: '2026-10-16', total: 395, currency: 'INR',
    items: [
      { name: 'Fortune Sunflower Oil 1L', qty: '1 pouch', price: 155 },
      { name: 'Tata Salt 1kg', qty: '2 pkts', price: 50 },
      { name: 'Aashirvaad Atta 5kg', qty: '1 bag', price: 190 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'kirana_en_02', synthetic: true, doc_type: 'kirana', script: 'english', variation: 'thermal_faded',
    merchant: 'New City Provision Store', date: '2026-10-23', total: 215, currency: 'INR',
    items: [
      { name: 'Brooke Bond Red Label Tea', qty: '250 g', price: 135 },
      { name: 'Sugar Medium', qty: '2 kg', price: 80 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'kirana_mixed_01', synthetic: true, doc_type: 'kirana', script: 'mixed', variation: 'rotation',
    merchant: 'Sri Balaji Kirana & జనరల్ స్టోర్స్', date: '2026-10-17', total: 540, currency: 'INR',
    items: [
      { name: 'Sona Masoori బియ్యం 5kg', qty: '1 bag', price: 330 },
      { name: 'Surf Excel వాషింగ్ పౌడర్', qty: '1 kg', price: 140 },
      { name: 'Lifebuoy సబ్బు', qty: '2 pcs', price: 70 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'kirana_mixed_02', synthetic: true, doc_type: 'kirana', script: 'mixed', variation: 'blur',
    merchant: 'Shree Ram किराना & Daily Needs', date: '2026-10-24', total: 380, currency: 'INR',
    items: [
      { name: 'Good Day बिस्कुट 4-pack', qty: '1 pkt', price: 80 },
      { name: 'Maggi Noodles मसाला', qty: '1 pack', price: 140 },
      { name: 'Amul Butter बटर 100g', qty: '2 pcs', price: 160 },
    ],
    mrp: null, expiry: null, gstin: '27AAAAA0000A1Z1',
  },

  // ── Pharmacy Bills (8) ────────────────────────────────────────────────────
  {
    id: 'pharma_en_01', synthetic: true, doc_type: 'pharmacy', script: 'english', variation: 'clean',
    merchant: 'Apollo SafeCare Pharmacy', date: '2026-10-20', total: 342, currency: 'INR',
    items: [
      { name: 'Dolo 650mg Paracetamol Tab', qty: '15 tabs', price: 42 },
      { name: 'Augmentin 625 Duo Tab', qty: '10 tabs', price: 180 },
      { name: 'Benadryl Cough Syrup 100ml', qty: '1 bottle', price: 120 },
    ],
    mrp: 360, batch: 'BTH-9942', expiry: '2027-12', gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'pharma_en_02', synthetic: true, doc_type: 'pharmacy', script: 'english', variation: 'rotation',
    merchant: 'MedPlus Health Care Chemists', date: '2026-10-22', total: 275, currency: 'INR',
    items: [
      { name: 'Pantocid DSR Capsule', qty: '10 caps', price: 165 },
      { name: 'Cetirizine 10mg Tab', qty: '20 tabs', price: 50 },
      { name: 'Electral Powder 21.8g', qty: '3 sachets', price: 60 },
    ],
    mrp: 290, batch: 'MP-4410', expiry: '2028-05', gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'pharma_en_03', synthetic: true, doc_type: 'pharmacy', script: 'english', variation: 'phone_shadow',
    merchant: 'Lifeline Medical & General Stores', date: '2026-10-25', total: 450, currency: 'INR',
    items: [
      { name: 'Telma 40mg Tablet', qty: '30 tabs', price: 280 },
      { name: 'Ecosprin 75mg Tablet', qty: '14 tabs', price: 30 },
      { name: 'Shelcal 500mg Calcium', qty: '15 tabs', price: 140 },
    ],
    mrp: 475, batch: 'LF-7891', expiry: '2027-09', gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'pharma_te_01', synthetic: true, doc_type: 'pharmacy', script: 'telugu', variation: 'clean',
    merchant: 'శ్రీనివాస మెడికల్స్', date: '2026-10-14', total: 195, currency: 'INR',
    items: [
      { name: 'జ్వరం మాత్రలు పారాసిటమాల్', qty: '10 మాత్రలు', price: 35 },
      { name: 'దగ్గు మందు సిరప్', qty: '1 బాటిల్', price: 110 },
      { name: 'విటమిన్ సి మాత్రలు', qty: '10 మాత్రలు', price: 50 },
    ],
    mrp: 210, batch: 'SN-320', expiry: '2027-10', gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'pharma_te_02', synthetic: true, doc_type: 'pharmacy', script: 'telugu', variation: 'thermal_faded',
    merchant: 'ఆరోగ్య ఫార్మసీ', date: '2026-10-19', total: 280, currency: 'INR',
    items: [
      { name: 'కడుపునొప్పి మాత్రలు', qty: '10 మాత్రలు', price: 90 },
      { name: 'ఓ ఆర్ ఎస్ ప్యాకెట్లు', qty: '4 ప్యాకెట్లు', price: 80 },
      { name: 'బాండేజ్ పట్టీ', qty: '2 రోల్స్', price: 110 },
    ],
    mrp: 300, batch: 'AR-109', expiry: '2028-02', gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'pharma_hi_01', synthetic: true, doc_type: 'pharmacy', script: 'hindi', variation: 'clean',
    merchant: 'संजीवनी मेडिकल स्टोर', date: '2026-10-18', total: 320, currency: 'INR',
    items: [
      { name: 'दर्द निवारक जेल Moov', qty: '1 ट्यूब', price: 135 },
      { name: 'गैस की गोली Rabeprazole', qty: '15 गोलियां', price: 125 },
      { name: 'पुदीन हरा कैप्सूल', qty: '10 कैप्सूल', price: 60 },
    ],
    mrp: 340, batch: 'SJ-552', expiry: '2027-11', gstin: '07AAAAA0000A1Z8',
  },
  {
    id: 'pharma_hi_02', synthetic: true, doc_type: 'pharmacy', script: 'hindi', variation: 'low_contrast',
    merchant: 'जन औषधि केंद्र दवाखाना', date: '2026-10-21', total: 145, currency: 'INR',
    items: [
      { name: 'पैरासिटामोल 500mg', qty: '20 गोलियां', price: 20 },
      { name: 'मल्टीविटामिन सिरप', qty: '1 बोतल', price: 85 },
      { name: 'बैंड एड पट्टी', qty: '10 स्ट्रिप', price: 40 },
    ],
    mrp: 155, batch: 'JAS-09', expiry: '2028-01', gstin: '08AAAAA0000A1Z9',
  },
  {
    id: 'pharma_mixed_01', synthetic: true, doc_type: 'pharmacy', script: 'mixed', variation: 'rotation',
    merchant: 'National SafeCare Medicals మెడికల్స్', date: '2026-10-23', total: 410, currency: 'INR',
    items: [
      { name: 'Azithromycin 500mg అజిత్రోమైసిన్', qty: '5 tabs', price: 120 },
      { name: 'Ascoril D Plus Syrup సిరప్', qty: '1 bottle', price: 140 },
      { name: 'Volini Pain Spray స్ప్రే', qty: '1 can', price: 150 },
    ],
    mrp: 435, batch: 'NSM-77', expiry: '2027-08', gstin: '36AAAAA0000A1Z5',
  },

  // ── Restaurant Bills (8) ──────────────────────────────────────────────────
  {
    id: 'restaurant_en_01', synthetic: true, doc_type: 'restaurant', script: 'english', variation: 'clean',
    merchant: 'Swagath Udupi Grand', date: '2026-10-17', total: 336, currency: 'INR',
    items: [
      { name: 'Masala Dosa', qty: '2', price: 160 },
      { name: 'Idli Vada Combo', qty: '1', price: 90 },
      { name: 'Filter Coffee', qty: '2', price: 70 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'restaurant_en_02', synthetic: true, doc_type: 'restaurant', script: 'english', variation: 'phone_shadow',
    merchant: 'Paradise Biryani Hub', date: '2026-10-21', total: 682, currency: 'INR',
    items: [
      { name: 'Special Chicken Biryani', qty: '1', price: 380 },
      { name: 'Butter Naan', qty: '3', price: 150 },
      { name: 'Paneer Butter Masala', qty: '1', price: 120 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'restaurant_te_01', synthetic: true, doc_type: 'restaurant', script: 'telugu', variation: 'clean',
    merchant: 'గోదావరి రుచులు రెస్టారెంట్', date: '2026-10-18', total: 472, currency: 'INR',
    items: [
      { name: 'నాటుకోడి పులావ్', qty: '1', price: 290 },
      { name: 'గోంగూర పచ్చడి అన్నం', qty: '1', price: 110 },
      { name: 'మజ్జిగ', qty: '2', price: 50 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'restaurant_te_02', synthetic: true, doc_type: 'restaurant', script: 'telugu', variation: 'thermal_faded',
    merchant: 'శ్రీ కాకతీయ మెస్', date: '2026-10-22', total: 262, currency: 'INR',
    items: [
      { name: 'ఆంధ్రా భోజనం మీల్స్', qty: '2', price: 220 },
      { name: 'స్పెషల్ పెరుగు', qty: '1', price: 30 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'restaurant_hi_01', synthetic: true, doc_type: 'restaurant', script: 'hindi', variation: 'clean',
    merchant: 'शाकाहारी भोजन वाटिका', date: '2026-10-15', total: 399, currency: 'INR',
    items: [
      { name: 'दाल मखनी', qty: '1', price: 180 },
      { name: 'तंदूरी रोटी', qty: '4', price: 80 },
      { name: 'जीरा राइस', qty: '1', price: 120 },
    ],
    mrp: null, expiry: null, gstin: '07AAAAA0000A1Z8',
  },
  {
    id: 'restaurant_hi_02', synthetic: true, doc_type: 'restaurant', script: 'hindi', variation: 'low_contrast',
    merchant: 'दिल्ली स्वाद ढाबा', date: '2026-10-20', total: 294, currency: 'INR',
    items: [
      { name: 'छोले भटूरे', qty: '2 प्लेट', price: 180 },
      { name: 'मीठी लस्सी', qty: '2 गिलास', price: 100 },
    ],
    mrp: null, expiry: null, gstin: '06AAAAA0000A1Z7',
  },
  {
    id: 'restaurant_mixed_01', synthetic: true, doc_type: 'restaurant', script: 'mixed', variation: 'rotation',
    merchant: 'Anand Bhavan Tiffins ఆనంద్ భవన్', date: '2026-10-23', total: 241, currency: 'INR',
    items: [
      { name: 'Onion Rava Dosa ఉల్లి రవ్వ దోశ', qty: '1', price: 95 },
      { name: 'Poori Bhaji పూరి కూర', qty: '1', price: 85 },
      { name: 'Special Tea టీ', qty: '2', price: 50 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },
  {
    id: 'restaurant_mixed_02', synthetic: true, doc_type: 'restaurant', script: 'mixed', variation: 'blur',
    merchant: 'Punjab Rasoi పంజాబ్ రసోయి', date: '2026-10-24', total: 462, currency: 'INR',
    items: [
      { name: 'Paneer Tikka పన్నీర్ టిక్కా', qty: '1', price: 240 },
      { name: 'Garlic Naan గార్లిక్ నాన్', qty: '2', price: 120 },
      { name: 'Sweet Lassi లస్సీ', qty: '1', price: 80 },
    ],
    mrp: null, expiry: null, gstin: '36AAAAA0000A1Z5',
  },

  // ── Electricity / Utility Bills (6) ───────────────────────────────────────
  {
    id: 'utility_en_01', synthetic: true, doc_type: 'utility', script: 'english', variation: 'clean',
    merchant: 'TGSPDCL Southern Power', date: '2026-10-12', total: 1420, currency: 'INR',
    items: [
      { name: 'Electricity Consumption Charges 210 units', qty: '210 kWh', price: 1300 },
      { name: 'Customer Charges', qty: '1', price: 120 },
    ],
    consumer_no: 'TG-9876543210', due_date: '2026-10-28', mrp: null, expiry: null,
  },
  {
    id: 'utility_en_02', synthetic: true, doc_type: 'utility', script: 'english', variation: 'phone_shadow',
    merchant: 'HMWSSB Water Supply Board', date: '2026-10-10', total: 560, currency: 'INR',
    items: [
      { name: 'Monthly Water Supply & Sewerage', qty: '1 month', price: 560 },
    ],
    consumer_no: 'CAN-44210988', due_date: '2026-10-25', mrp: null, expiry: null,
  },
  {
    id: 'utility_te_01', synthetic: true, doc_type: 'utility', script: 'telugu', variation: 'clean',
    merchant: 'తెలంగాణ విద్యుత్ సరఫరా సంస్థ TGSPDCL', date: '2026-10-11', total: 890, currency: 'INR',
    items: [
      { name: 'గృహ విద్యుత్ ఛార్జీలు 140 యూనిట్లు', qty: '140 units', price: 770 },
      { name: 'స్థిర ఛార్జీలు', qty: '1', price: 120 },
    ],
    consumer_no: 'USC-11223344', due_date: '2026-10-26', mrp: null, expiry: null,
  },
  {
    id: 'utility_te_02', synthetic: true, doc_type: 'utility', script: 'telugu', variation: 'rotation',
    merchant: 'ఉత్తర విద్యుత్ పంపిణీ సంస్థ TSNPDCL', date: '2026-10-14', total: 1150, currency: 'INR',
    items: [
      { name: 'కరెంట్ బిల్లు LT-1B', qty: '185 units', price: 1030 },
      { name: 'కస్టమర్ ఛార్జీలు', qty: '1', price: 120 },
    ],
    consumer_no: 'SC-88776655', due_date: '2026-10-30', mrp: null, expiry: null,
  },
  {
    id: 'utility_hi_01', synthetic: true, doc_type: 'utility', script: 'hindi', variation: 'low_contrast',
    merchant: 'मध्य प्रदेश विद्युत वितरण कंपनी', date: '2026-10-13', total: 980, currency: 'INR',
    items: [
      { name: 'घरेलू बिजली खपत 160 यूनिट', qty: '160 units', price: 860 },
      { name: 'नियत प्रभार', qty: '1', price: 120 },
    ],
    consumer_no: 'MP-55443322', due_date: '2026-10-29', mrp: null, expiry: null,
  },
  {
    id: 'utility_mixed_01', synthetic: true, doc_type: 'utility', script: 'mixed', variation: 'blur',
    merchant: 'BSES Yamuna Power Limited यमुना पावर', date: '2026-10-15', total: 1650, currency: 'INR',
    items: [
      { name: 'Electricity Charges बिजली शुल्क', qty: '250 units', price: 1530 },
      { name: 'Fixed Charges', qty: '1', price: 120 },
    ],
    consumer_no: 'CA-10293847', due_date: '2026-10-31', mrp: null, expiry: null,
  },

  // ── Packaged Product Labels (8) ───────────────────────────────────────────
  {
    id: 'product_en_01', synthetic: true, doc_type: 'product_label', script: 'english', variation: 'clean',
    merchant: 'NaturePure Foods', date: '2026-09-20', total: 275, currency: 'INR',
    items: [
      { name: 'Cold Pressed Groundnut Oil', qty: '1 Litre', price: 275 },
    ],
    mrp: 299, expiry: '2027-09-20',
  },
  {
    id: 'product_en_02', synthetic: true, doc_type: 'product_label', script: 'english', variation: 'low_contrast',
    merchant: 'AyurGlow Care', date: '2026-08-15', total: 180, currency: 'INR',
    items: [
      { name: 'Pure Herbal Aloe Vera Gel', qty: '200 g', price: 180 },
    ],
    mrp: 199, expiry: '2028-08-15',
  },
  {
    id: 'product_te_01', synthetic: true, doc_type: 'product_label', script: 'telugu', variation: 'clean',
    merchant: 'గోదావరి నేచురల్స్', date: '2026-09-15', total: 240, currency: 'INR',
    items: [
      { name: 'గానుగ నువ్వుల నూనె Sesame Oil', qty: '500 ml', price: 240 },
    ],
    mrp: 260, expiry: '2027-03-15',
  },
  {
    id: 'product_te_02', synthetic: true, doc_type: 'product_label', script: 'telugu', variation: 'phone_shadow',
    merchant: 'శ్రీ వేంకటేశ్వర ఆగ్రో', date: '2026-10-01', total: 320, currency: 'INR',
    items: [
      { name: 'స్వచ్ఛమైన కొబ్బరి నూనె Coconut Oil', qty: '1000 ml', price: 320 },
    ],
    mrp: 350, expiry: '2027-10-01',
  },
  {
    id: 'product_hi_01', synthetic: true, doc_type: 'product_label', script: 'hindi', variation: 'clean',
    merchant: 'शुद्ध आहार ग्रामोद्योग', date: '2026-09-10', total: 650, currency: 'INR',
    items: [
      { name: 'शुद्ध देसी गाय का घी Pure Ghee', qty: '1 kg', price: 650 },
    ],
    mrp: 700, expiry: '2027-06-10',
  },
  {
    id: 'product_hi_02', synthetic: true, doc_type: 'product_label', script: 'hindi', variation: 'rotation',
    merchant: 'हिमालय जड़ी-बूटी भंडार', date: '2026-08-25', total: 220, currency: 'INR',
    items: [
      { name: 'अश्वगंधा चूर्ण Ashwagandha Powder', qty: '250 g', price: 220 },
    ],
    mrp: 240, expiry: '2028-08-25',
  },
  {
    id: 'product_mixed_01', synthetic: true, doc_type: 'product_label', script: 'mixed', variation: 'blur',
    merchant: 'Deccan Spices డెక్కన్ స్పైసెస్', date: '2026-09-18', total: 140, currency: 'INR',
    items: [
      { name: 'Guntur Red Chilli Powder గుంటూరు కారం', qty: '500 g', price: 140 },
    ],
    mrp: 155, expiry: '2027-09-18',
  },
  {
    id: 'product_mixed_02', synthetic: true, doc_type: 'product_label', script: 'mixed', variation: 'thermal_faded',
    merchant: 'Kisan Shakti किसान शक्ति', date: '2026-10-05', total: 95, currency: 'INR',
    items: [
      { name: 'Chana Sattu चना सत्तू', qty: '500 g', price: 95 },
    ],
    mrp: 110, expiry: '2027-04-05',
  },
]

// ── Runner ──────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2)
  let limit = null
  let singleId = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') limit = Number(argv[++i])
    else if (argv[i] === '--id') singleId = argv[++i]
  }

  let list = FIXTURES
  if (singleId) list = list.filter((f) => f.id === singleId)
  if (Number.isFinite(limit) && limit > 0) list = list.slice(0, limit)

  console.log(`Rendering ${list.length} synthetic fixtures to ${fixturesDir}...`)
  for (const [idx, item] of list.entries()) {
    const pngPath = join(fixturesDir, `${item.id}.png`)
    const jsonPath = join(fixturesDir, `${item.id}.json`)
    const html = generateHtml(item)

    // Render image
    await renderHtmlToPng(html, pngPath, 480, 680)

    // Save matching ground truth JSON
    writeFileSync(jsonPath, JSON.stringify(item, null, 2) + '\n', 'utf8')
    console.log(`[${idx + 1}/${list.length}] Generated ${item.id}.png + ${item.id}.json (${item.doc_type}, ${item.script}, ${item.variation})`)
  }
  console.log(`Done! All fixtures created in ${fixturesDir}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('make-fixtures failed:', err)
    process.exit(1)
  })
}
