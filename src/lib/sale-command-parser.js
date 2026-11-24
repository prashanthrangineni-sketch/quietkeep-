// src/lib/sale-command-parser.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side natural language text command parser for sales (Aaria & Counter).
//
// Examples:
//   "3 chai 2 samosa cash" -> 3 Chai, 2 Samosa, Cash
//   "teen chai do samosa cash" / "३ चाय २ समोसा नकद" -> 3 Chai, 2 Samosa, Cash
//   "moodu chai rendu samosa cash" / "మూడు చాయ్ రెండు సమోసా నగదు" -> 3 Chai, 2 Samosa, Cash
//   "రెండు టీ ఒక కాఫీ యుపిఐ" -> 2 Chai, 1 Coffee, UPI
//   "3 muffins 2 chai cash" -> unknown word "muffins" prompts to pick from shop items
// ─────────────────────────────────────────────────────────────────────────────

// Digits mapping
const DIGIT_MAP = {
  // Devanagari numerals
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  // Telugu numerals
  '౦': '0', '౧': '1', '౨': '2', '౩': '3', '౪': '4',
  '౫': '5', '౬': '6', '౭': '7', '౮': '8', '౯': '9',
};

// Word numbers in English, Hindi, Telugu (Romanised and Native)
const NUMBER_WORDS = {
  // English
  'a': 1, 'an': 1, 'one': 1, 'single': 1,
  'two': 2, 'double': 2,
  'three': 3, 'triple': 3,
  'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'half': 0.5,

  // Hindi (Romanised)
  'ek': 1, 'do': 2, 'teen': 3, 'tin': 3, 'chaar': 4, 'char': 4,
  'paanch': 5, 'panch': 5, 'chhah': 6, 'che': 6, 'chhe': 6,
  'saat': 7, 'sat': 7, 'aath': 8, 'ath': 8, 'nau': 9, 'das': 10,
  'aadha': 0.5, 'adha': 0.5, 'dhai': 2.5, 'dedh': 1.5,

  // Hindi (Devanagari)
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5,
  'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'आधा': 0.5,

  // Telugu (Romanised)
  'okati': 1, 'oka': 1, 'rendu': 2, 'moodu': 3, 'mudu': 3,
  'naalugu': 4, 'nalugu': 4, 'aidu': 5, 'ayidu': 5, 'aaru': 6,
  'yedu': 7, 'edu': 7, 'enimidi': 8, 'tommidi': 9, 'padi': 10,
  'sagam': 0.5,

  // Telugu (Native Script)
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4,
  'ఐదు': 5, 'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10,
  'సగం': 0.5,
};

// Payment modes mapping
const PAYMENT_MODES = {
  // Cash (English, Hindi, Telugu)
  'cash': 'cash',
  'cashe': 'cash',
  'nakad': 'cash',
  'naqad': 'cash',
  'roka': 'cash',
  'rokad': 'cash',
  'rokkam': 'cash',
  'nagadu': 'cash',
  'nagad': 'cash',
  'नकद': 'cash',
  'रोकड़': 'cash',
  'कैश': 'cash',
  'నగదు': 'cash',
  'క్యాష్': 'cash',

  // UPI / Online (English, Hindi, Telugu)
  'upi': 'upi',
  'online': 'upi',
  'gpay': 'upi',
  'googlepay': 'upi',
  'phonepe': 'upi',
  'paytm': 'upi',
  'qr': 'upi',
  'scan': 'upi',
  'pay': 'upi',
  'यूपीआई': 'upi',
  'ऑनलाइन': 'upi',
  'ఫోన్‌పే': 'upi',
  'యుపిఐ': 'upi',
  'యూపీఐ': 'upi',
  'ఆన్లైన్': 'upi',
};

// Common shop item synonyms across English, Hindi, Telugu
const COMMON_ITEMS_DICTIONARY = [
  {
    canonical: 'Chai',
    synonyms: [
      'chai', 'tea', 'chaai', 'chaya', 'kadak chai', 'cutting chai', 'masala chai',
      'चाय', 'टी', 'कड़क चाय',
      'టీ', 'చాయ్', 'టీలు',
    ],
  },
  {
    canonical: 'Samosa',
    synonyms: [
      'samosa', 'samose', 'samosas',
      'समोसा', 'समोसे',
      'సమోసా', 'సమోసాలు',
    ],
  },
  {
    canonical: 'Coffee',
    synonyms: [
      'coffee', 'kapi', 'kaapi', 'filter coffee',
      'कॉफ़ी', 'कॉफी',
      'కాఫీ', 'ఫిల్టర్ కాఫీ',
    ],
  },
  {
    canonical: 'Biscuit',
    synonyms: [
      'biscuit', 'biscuits', 'bisket', 'biscut', 'cookie',
      'बिस्कुट', 'बिस्किट',
      'బిస్కెట్', 'బిస్కెట్లు',
    ],
  },
  {
    canonical: 'Bun Maska',
    synonyms: [
      'bun maska', 'bun', 'maska bun',
      'बन मस्का', 'बन',
      'బన్ మస్కా', 'బన్',
    ],
  },
  {
    canonical: 'Idli',
    synonyms: [
      'idli', 'idly', 'idlis',
      'इडली',
      'ఇడ్లీ', 'ఇడ్లీలు',
    ],
  },
  {
    canonical: 'Vada',
    synonyms: [
      'vada', 'vadai', 'wada', 'medu vada',
      'वड़ा', 'मेदु वड़ा',
      'వడ', 'వడలు', 'గారె',
    ],
  },
  {
    canonical: 'Dosa',
    synonyms: [
      'dosa', 'dosai', 'masala dosa',
      'डोसा', 'मसाला डोसा',
      'దోశ', 'దోస', 'మసాలా దోశ',
    ],
  },
  {
    canonical: 'Cigarette',
    synonyms: [
      'cigarette', 'sutta', 'cig', 'cigarettes',
      'सिगरेट', 'सुट्टा',
      'సిగరెట్',
    ],
  },
  {
    canonical: 'Water',
    synonyms: [
      'water', 'water bottle', 'bottle', 'pani', 'paani',
      'पानी', 'पानी बोतल',
      'నీళ్ళు', 'వాటర్ బాటిల్',
    ],
  },
  {
    canonical: 'Paan',
    synonyms: [
      'paan', 'pan', 'meetha paan',
      'पान', 'मीठा पान',
      'పాన్', 'కిళ్లీ',
    ],
  },
  {
    canonical: 'Milk',
    synonyms: [
      'milk', 'doodh', 'dudh', 'paalu',
      'दूध',
      'పాలు',
    ],
  },
  {
    canonical: 'Maggi',
    synonyms: [
      'maggi', 'maggie', 'noodles',
      'मैगी',
      'మ్యాగీ',
    ],
  },
];

// Filler words to ignore (connectives in En, Hi, Te)
const FILLER_WORDS = new Set([
  'and', 'aur', 'plus', '+', '&', 'mariyu', 'inka', 'kuda',
  'give', 'do', 'de', 'dena', 'karo', 'chudu', 'kavali', 'ivvu',
  'rupees', 'rs', 'inr', 'ka', 'ke', 'ki', 'lo',
]);

/**
 * Replace Devanagari and Telugu numerals with standard digits
 */
function normalizeDigits(str) {
  return str.replace(/[\u0966-\u096F\u0C66-\u0C6F]/g, m => DIGIT_MAP[m] || m);
}

/**
 * Parse a number value from a token (e.g. "3", "teen", "రెండు")
 */
function parseQuantityToken(token) {
  const norm = token.toLowerCase().trim();
  if (/^\d+(\.\d+)?$/.test(norm)) {
    return parseFloat(norm);
  }
  if (NUMBER_WORDS[norm] !== undefined) {
    return NUMBER_WORDS[norm];
  }
  return null;
}

/**
 * Match a raw phrase against shop inventory items or dictionary.
 */
function matchItem(phrase, shopItems = []) {
  const p = phrase.trim().toLowerCase();
  if (!p) return null;

  // 1. Direct match with shop inventory items
  if (Array.isArray(shopItems) && shopItems.length > 0) {
    // Exact or case-insensitive name / SKU match
    for (const item of shopItems) {
      const name = (item.name || '').trim().toLowerCase();
      const sku = (item.sku || '').trim().toLowerCase();
      if (name === p || sku === p) {
        return {
          matched: true,
          item_id: item.id,
          name: item.name,
          unit_price: Number(item.selling_price || item.purchase_price || 0),
          is_made_on_spot: Boolean(item.is_made_on_spot),
          recipe: item.recipe || [],
          raw: phrase,
        };
      }
    }

    // Substring / partial match on shop items
    for (const item of shopItems) {
      const name = (item.name || '').trim().toLowerCase();
      if (name.includes(p) || p.includes(name)) {
        return {
          matched: true,
          item_id: item.id,
          name: item.name,
          unit_price: Number(item.selling_price || item.purchase_price || 0),
          is_made_on_spot: Boolean(item.is_made_on_spot),
          recipe: item.recipe || [],
          raw: phrase,
        };
      }
    }
  }

  // 2. Check common items dictionary
  for (const entry of COMMON_ITEMS_DICTIONARY) {
    for (const syn of entry.synonyms) {
      const synLower = syn.toLowerCase();
      if (synLower === p || synLower.includes(p) || p.includes(synLower)) {
        // If shop has an item with matching canonical or synonym name, link it
        let matchedShopItem = null;
        if (Array.isArray(shopItems)) {
          matchedShopItem = shopItems.find(si => {
            const siName = (si.name || '').toLowerCase();
            return siName.includes(entry.canonical.toLowerCase()) ||
                   entry.synonyms.some(s => siName.includes(s.toLowerCase()));
          });
        }

        return {
          matched: true,
          item_id: matchedShopItem ? matchedShopItem.id : null,
          name: matchedShopItem ? matchedShopItem.name : entry.canonical,
          unit_price: matchedShopItem ? Number(matchedShopItem.selling_price || 0) : 0,
          is_made_on_spot: matchedShopItem ? Boolean(matchedShopItem.is_made_on_spot) : false,
          recipe: matchedShopItem ? matchedShopItem.recipe || [] : [],
          raw: phrase,
        };
      }
    }
  }

  // 3. Unknown item: caller must ask to pick from shop's items
  return {
    matched: false,
    item_id: null,
    name: phrase,
    raw_name: phrase,
    unit_price: 0,
    needs_disambiguation: true,
    raw: phrase,
  };
}

/**
 * Main parser: converts text commands into items, quantities, and payment mode.
 *
 * @param {string} input - Text command (e.g. "3 chai 2 samosa cash")
 * @param {Array} shopItems - Optional array of inventory items from DB
 * @returns {object} Structured parse result
 */
export function parseSaleCommand(input = '', shopItems = []) {
  if (!input || typeof input !== 'string') {
    return {
      ok: false,
      error: 'Empty command',
      items: [],
      unknown_items: [],
      payment_mode: 'cash',
      total_amount: 0,
    };
  }

  let text = input.trim();

  // Normalize script digits (Devanagari, Telugu -> ASCII 0-9)
  text = normalizeDigits(text);

  // Extract payment mode
  let paymentMode = 'cash';
  const tokens = text.split(/[\s,]+/);
  const remainingTokens = [];

  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (PAYMENT_MODES[lower]) {
      paymentMode = PAYMENT_MODES[lower];
    } else {
      remainingTokens.push(t);
    }
  }

  // Parse items & quantities from tokens
  const parsedItems = [];
  let currentQty = null;
  let currentPhraseParts = [];

  function flushCurrent() {
    if (currentPhraseParts.length > 0) {
      const phrase = currentPhraseParts.join(' ').trim();
      if (phrase && !FILLER_WORDS.has(phrase.toLowerCase())) {
        const qty = currentQty !== null ? currentQty : 1;
        const match = matchItem(phrase, shopItems);
        if (match) {
          const unitPrice = match.unit_price || 0;
          parsedItems.push({
            ...match,
            quantity: qty,
            total_price: qty * unitPrice,
          });
        }
      }
      currentPhraseParts = [];
      currentQty = null;
    }
  }

  for (let i = 0; i < remainingTokens.length; i++) {
    const tok = remainingTokens[i];
    const lower = tok.toLowerCase();

    // Check if token is a quantity (digit or word number)
    const qtyVal = parseQuantityToken(tok);

    if (qtyVal !== null) {
      if (currentPhraseParts.length > 0) {
        // If we already had words and then encounter a number, flush the previous item
        flushCurrent();
      }
      currentQty = qtyVal;
    } else if (FILLER_WORDS.has(lower)) {
      // Connective or filler word (aur, and, etc.) flushes the item
      flushCurrent();
    } else {
      currentPhraseParts.push(tok);
    }
  }

  // Flush remaining item
  flushCurrent();

  // Separate known vs unknown items
  const knownItems = parsedItems.filter(i => i.matched);
  const unknownItems = parsedItems.filter(i => !i.matched);

  const totalAmount = knownItems.reduce((sum, item) => sum + (item.total_price || 0), 0);

  return {
    ok: true,
    raw_command: input,
    items: parsedItems,
    known_items: knownItems,
    unknown_items: unknownItems,
    payment_mode: paymentMode,
    total_amount: totalAmount,
    needs_confirmation: true,
    has_unknown: unknownItems.length > 0,
    available_shop_items: Array.isArray(shopItems)
      ? shopItems.map(si => ({
          id: si.id,
          name: si.name,
          selling_price: si.selling_price,
          unit: si.unit,
        }))
      : [],
  };
}
