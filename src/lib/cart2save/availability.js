// src/lib/cart2save/availability.js
// ─────────────────────────────────────────────────────────────────────────────
// Cart2Save Availability Label Rules (AG-1 / AG-3)
// ─────────────────────────────────────────────────────────────────────────────
// Availability label rules:
// - packaged items:
//     in_stock if count > 3,
//     few_left if 1-3,
//     hidden if 0
// - items marked "made on the spot":
//     available_while_open during opening hours
// - any item with no recorded sale or update for 3 hours during opening hours,
//   or shop accuracy score low:
//     call_to_confirm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the shop is currently open based on opening hours and target time.
 * Defaults to Indian Standard Time (IST, UTC+5:30).
 *
 * @param {object|string|null} hoursConfig
 * @param {Date|string|number} now
 * @returns {boolean}
 */
export function isShopOpen(hoursConfig, now = new Date()) {
  if (!hoursConfig) {
    // Default: Assume open during typical retail hours (08:00 - 22:00 IST)
    const date = now instanceof Date ? now : new Date(now);
    const istHours = getIstTimeInMinutes(date);
    return istHours >= 8 * 60 && istHours < 22 * 60;
  }

  const date = now instanceof Date ? now : new Date(now);
  const istMinutes = getIstTimeInMinutes(date);
  const istDayOfWeek = getIstDayOfWeek(date); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  // Case 1: String format "09:00 - 21:00"
  if (typeof hoursConfig === 'string') {
    const match = hoursConfig.match(/(\d{1,2}):(\d{2})\s*(?:-|to)\s*(\d{1,2}):(\d{2})/i);
    if (match) {
      const openMin = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      const closeMin = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
      return istMinutes >= openMin && istMinutes < closeMin;
    }
    return true;
  }

  // Case 2: Object format { open: "09:00", close: "21:00", days: [1,2,3,4,5,6] }
  if (typeof hoursConfig === 'object') {
    // Check specific day of week if configured
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = dayNames[istDayOfWeek];

    if (hoursConfig[currentDayName]) {
      const daySchedule = hoursConfig[currentDayName];
      if (daySchedule.closed) return false;
      if (daySchedule.open && daySchedule.close) {
        const [oH, oM] = daySchedule.open.split(':').map(Number);
        const [cH, cM] = daySchedule.close.split(':').map(Number);
        const openMin = oH * 60 + oM;
        const closeMin = cH * 60 + cM;
        return istMinutes >= openMin && istMinutes < closeMin;
      }
    }

    if (Array.isArray(hoursConfig.days) && !hoursConfig.days.includes(istDayOfWeek)) {
      return false; // Closed on this day
    }

    if (hoursConfig.open && hoursConfig.close) {
      const [oH, oM] = String(hoursConfig.open).split(':').map(Number);
      const [cH, cM] = String(hoursConfig.close).split(':').map(Number);
      const openMin = oH * 60 + (oM || 0);
      const closeMin = cH * 60 + (cM || 0);
      return istMinutes >= openMin && istMinutes < closeMin;
    }
  }

  return true;
}

/**
 * Returns current minutes from midnight in Indian Standard Time (UTC+5:30).
 */
function getIstTimeInMinutes(date) {
  const utcMs = date.getTime();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(utcMs + istOffsetMs);
  return istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
}

/**
 * Returns day of week in Indian Standard Time (0=Sunday, 6=Saturday).
 */
function getIstDayOfWeek(date) {
  const utcMs = date.getTime();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(utcMs + istOffsetMs);
  return istDate.getUTCDay();
}

/**
 * Determines whether a shop's accuracy score is considered low.
 * Scale is 0-100 (aligned with PR #269, default 100). Low accuracy is < 70.
 * Also tolerates legacy fractional 0.0-1.0 scale if 0 < score <= 1.0.
 *
 * @param {number|null|undefined} score
 * @returns {boolean}
 */
export function isAccuracyScoreLow(score) {
  if (score === null || score === undefined) return false;
  const num = Number(score);
  if (isNaN(num)) return false;
  // If explicitly given in 0.0 - 1.0 fractional scale
  if (num > 0 && num <= 1.0) {
    return num < 0.7;
  }
  // Standard scale: 0 - 100 (default 100)
  return num < 70;
}

/**
 * Calculates the Cart2Save availability label for an item.
 *
 * @param {object} params
 * @param {object} params.item
 * @param {number|string} [params.item.current_stock]
 * @param {boolean} [params.item.is_made_on_spot]
 * @param {string|Date} [params.item.last_sale_at]
 * @param {string|Date} [params.item.updated_at]
 * @param {string|Date} [params.item.created_at]
 * @param {object} [params.shop]
 * @param {number} [params.shop.accuracy_score]
 * @param {object|string} [params.shop.hours]
 * @param {object|string} [params.shop.opening_hours]
 * @param {Date|string|number} [params.now]
 * @returns {'in_stock' | 'few_left' | 'hidden' | 'available_while_open' | 'call_to_confirm' | 'closed'}
 */
export function calculateAvailabilityLabel({ item, shop = {}, now = new Date() }) {
  if (!item) return 'hidden';

  const currentDate = now instanceof Date ? now : new Date(now);
  const isMadeOnSpot = Boolean(item.is_made_on_spot);
  const stock = item.current_stock !== undefined && item.current_stock !== null && item.current_stock !== ''
    ? Number(item.current_stock)
    : null;

  // 1. Packaged items: hidden if count is 0 (or less)
  if (!isMadeOnSpot && stock !== null && stock <= 0) {
    return 'hidden';
  }

  // 2. Check shop opening hours
  const hours = shop.hours || shop.opening_hours;
  const open = isShopOpen(hours, currentDate);

  if (!open) {
    // Outside opening hours
    return 'closed';
  }

  // 3. Shop accuracy score check: low score triggers call_to_confirm during open hours
  const accuracyLow = isAccuracyScoreLow(shop.accuracy_score);

  // 4. Stale check: no recorded sale or update for 3 hours during opening hours
  const lastActivityTime = item.last_sale_at || item.updated_at || item.created_at;
  let isStale = false;
  if (lastActivityTime) {
    const activityMs = new Date(lastActivityTime).getTime();
    if (!isNaN(activityMs)) {
      const elapsedHours = (currentDate.getTime() - activityMs) / (1000 * 60 * 60);
      if (elapsedHours >= 3) {
        isStale = true;
      }
    }
  }

  // If shop accuracy score is low OR item hasn't had a sale/update in 3+ hours
  if (accuracyLow || isStale) {
    return 'call_to_confirm';
  }

  // 5. Items marked "made on the spot"
  if (isMadeOnSpot) {
    return 'available_while_open';
  }

  // 6. Packaged items:
  // count > 3 => in_stock
  // count 1-3 => few_left
  if (stock !== null) {
    if (stock > 3) return 'in_stock';
    if (stock >= 1) return 'few_left';
    return 'hidden';
  }

  // Fallback if stock is undefined on a non-spot item
  return 'in_stock';
}
