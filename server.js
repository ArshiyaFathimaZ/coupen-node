// server.js
// Simple Coupon Management service (in-memory)
// Node.js + Express
// Usage: node server.js
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

/**
 * In-memory stores
 */
const coupons = []; // list of coupon objects
// usageRecords: { userId: { couponCode: usageCount, ... }, ... }
const usageRecords = {};
// seed users - demo login required by assignment
const users = [
  {
    userId: 'demo-uid-1',
    email: 'hire-me@anshumat.org',
    password: 'HireMe@2025!',
    userTier: 'NEW',
    country: 'IN',
    lifetimeSpend: 0,
    ordersPlaced: 0,
  }
];

/**
 * Helpers
 */
function nowISO() {
  return new Date().toISOString();
}

function parseDateSafe(s) {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

function computeCartValue(cart) {
  if (!cart || !Array.isArray(cart.items)) return 0;
  return cart.items.reduce((sum, it) => {
    const qty = Number(it.quantity || 0);
    const price = Number(it.unitPrice || 0);
    return sum + Math.max(0, qty * price);
  }, 0);
}

function totalItemsCount(cart) {
  if (!cart || !Array.isArray(cart.items)) return 0;
  return cart.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
}

/**
 * Validate coupon payload (basic)
 * Returns { valid: boolean, errors: [] }
 */
function validateCouponPayload(c) {
  const errors = [];
  if (!c || typeof c !== 'object') {
    errors.push('Body must be a JSON coupon object');
    return { valid: false, errors };
  }
  if (!c.code || typeof c.code !== 'string') errors.push('code required (string)');
  if (!c.description) errors.push('description required');
  if (!['FLAT', 'PERCENT'].includes(c.discountType)) errors.push('discountType must be "FLAT" or "PERCENT"');
  if (typeof c.discountValue !== 'number' || c.discountValue < 0) errors.push('discountValue must be non-negative number');
  if (c.discountType === 'PERCENT') {
    if (c.maxDiscountAmount !== undefined && (typeof c.maxDiscountAmount !== 'number' || c.maxDiscountAmount < 0)) {
      errors.push('maxDiscountAmount must be non-negative number when provided');
    }
  }
  if (!parseDateSafe(c.startDate)) errors.push('startDate missing or invalid ISO date');
  if (!parseDateSafe(c.endDate)) errors.push('endDate missing or invalid ISO date');
  if (parseDateSafe(c.startDate) >= parseDateSafe(c.endDate)) errors.push('startDate must be before endDate');
  if (c.usageLimitPerUser !== undefined && (!Number.isInteger(c.usageLimitPerUser) || c.usageLimitPerUser < 1)) {
    errors.push('usageLimitPerUser must be integer >= 1 when provided');
  }
  // eligibility should be object if present
  if (c.eligibility !== undefined && typeof c.eligibility !== 'object') {
    errors.push('eligibility must be an object if provided');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Evaluate eligibility for a coupon given userContext and cart
 * Returns { eligible: boolean, reason?: string }
 *
 * Eligibility fields supported (all optional):
 * - allowedUserTiers: []
 * - minLifetimeSpend: number
 * - minOrdersPlaced: number
 * - firstOrderOnly: boolean
 * - allowedCountries: []
 * - minCartValue: number
 * - applicableCategories: [] (valid if at least one item matches)
 * - excludedCategories: [] (invalid if any item matches)
 * - minItemsCount: number (sum of quantities)
 */
function evaluateEligibility(coupon, userCtx, cart) {
  const e = coupon.eligibility || {};
  // user-based
  if (Array.isArray(e.allowedUserTiers) && e.allowedUserTiers.length > 0) {
    if (!userCtx || !e.allowedUserTiers.includes(userCtx.userTier)) return { eligible: false, reason: 'user tier not allowed' };
  }
  if (typeof e.minLifetimeSpend === 'number') {
    if (!userCtx || Number(userCtx.lifetimeSpend || 0) < e.minLifetimeSpend) return { eligible: false, reason: 'lifetime spend too low' };
  }
  if (typeof e.minOrdersPlaced === 'number') {
    if (!userCtx || Number(userCtx.ordersPlaced || 0) < e.minOrdersPlaced) return { eligible: false, reason: 'ordersPlaced too low' };
  }
  if (e.firstOrderOnly === true) {
    if (!userCtx || Number(userCtx.ordersPlaced || 0) !== 0) return { eligible: false, reason: 'not first order' };
  }
  if (Array.isArray(e.allowedCountries) && e.allowedCountries.length > 0) {
    if (!userCtx || !e.allowedCountries.includes(userCtx.country)) return { eligible: false, reason: 'country not allowed' };
  }
  // cart-based
  const cartValue = computeCartValue(cart);
  if (typeof e.minCartValue === 'number') {
    if (cartValue < e.minCartValue) return { eligible: false, reason: 'cart value too low' };
  }
  const items = Array.isArray(cart && cart.items) ? cart.items : [];
  if (Array.isArray(e.applicableCategories) && e.applicableCategories.length > 0) {
    // valid if at least one item category is in applicableCategories
    const found = items.some(it => e.applicableCategories.includes(it.category));
    if (!found) return { eligible: false, reason: 'no applicable categories in cart' };
  }
  if (Array.isArray(e.excludedCategories) && e.excludedCategories.length > 0) {
    const found = items.some(it => e.excludedCategories.includes(it.category));
    if (found) return { eligible: false, reason: 'cart has excluded category' };
  }
  if (typeof e.minItemsCount === 'number') {
    if (totalItemsCount(cart) < e.minItemsCount) return { eligible: false, reason: 'not enough items in cart' };
  }

  return { eligible: true };
}

/**
 * Compute discount value for coupon given cartValue
 * Returns numeric discount >= 0
 */
function computeDiscountAmount(coupon, cartValue) {
  if (coupon.discountType === 'FLAT') {
    return Math.min(Number(coupon.discountValue || 0), cartValue);
  } else if (coupon.discountType === 'PERCENT') {
    const raw = (Number(coupon.discountValue || 0) / 100) * cartValue;
    if (coupon.maxDiscountAmount !== undefined && coupon.maxDiscountAmount !== null) {
      return Math.min(raw, Number(coupon.maxDiscountAmount));
    }
    return raw;
  }
  return 0;
}

/**
 * Check usage limit per user
 */
function checkUsageLimit(coupon, userId) {
  if (!coupon.usageLimitPerUser) return true;
  const userUsage = (usageRecords[userId] && usageRecords[userId][coupon.code]) || 0;
  return userUsage < coupon.usageLimitPerUser;
}

/**
 * POST /coupons
 * Create coupon (reject duplicates)
 */
app.post('/coupons', (req, res) => {
  const payload = req.body;
  const v = validateCouponPayload(payload);
  if (!v.valid) {
    return res.status(400).json({ error: 'invalid coupon', details: v.errors });
  }
  const existing = coupons.find(c => c.code === payload.code);
  if (existing) {
    // assignment said we can choose; here we REJECT duplicates to be explicit.
    return res.status(409).json({ error: 'coupon code already exists. duplicate creation rejected' });
  }
  // normalize some fields
  const couponToStore = Object.assign({}, payload);
  couponToStore.startDate = parseDateSafe(couponToStore.startDate).toISOString();
  couponToStore.endDate = parseDateSafe(couponToStore.endDate).toISOString();
  coupons.push(couponToStore);
  return res.status(201).json({ message: 'coupon created', coupon: couponToStore });
});

/**
 * GET /coupons
 */
app.get('/coupons', (req, res) => {
  res.json({ coupons });
});

/**
 * POST /best-coupon
 * Body: { userContext: {...}, cart: {...}, userId: 'u123' (optional) }
 * userContext can contain the user attributes as specified in assignment.
 */
app.post('/best-coupon', (req, res) => {
  const { userContext, cart, userId } = req.body || {};
  const now = new Date();
  const cartValue = computeCartValue(cart);
  const candidateResults = [];

  for (const c of coupons) {
    const start = parseDateSafe(c.startDate);
    const end = parseDateSafe(c.endDate);
    if (!start || !end) continue; // skip malformed
    if (!(start <= now && now <= end)) continue; // not in validity window

    // usage limit check
    const uid = userId || (userContext && userContext.userId) || 'anonymous';
    if (!checkUsageLimit(c, uid)) continue;

    // evaluate eligibility
    const elig = evaluateEligibility(c, userContext, cart);
    if (!elig.eligible) continue;

    // compute discount
    const discount = computeDiscountAmount(c, cartValue);
    if (discount <= 0) continue; // no effective discount (e.g., zero)
    candidateResults.push({
      coupon: c,
      discount,
      endDate: parseDateSafe(c.endDate)
    });
  }

  if (candidateResults.length === 0) {
    return res.json({ best: null });
  }

  // select best according to rules:
  // 1) highest discount amount
  // 2) if tie, earliest endDate (so expiring sooner wins)
  // 3) if still tie, lexicographically smaller code
  candidateResults.sort((a, b) => {
    if (b.discount !== a.discount) return b.discount - a.discount; // high -> low
    if (a.endDate.getTime() !== b.endDate.getTime()) return a.endDate - b.endDate; // earlier date -> smaller
    return a.coupon.code.localeCompare(b.coupon.code); // lexicographic
  });

  const winner = candidateResults[0];
  return res.json({
    best: {
      code: winner.coupon.code,
      description: winner.coupon.description,
      discountAmount: Number(winner.discount.toFixed(2)),
      coupon: winner.coupon
    }
  });
});

/**
 * POST /use-coupon
 * (helper) Mark coupon as used by a user once purchase is done — increments usage count.
 * Body: { userId, couponCode }
 */
app.post('/use-coupon', (req, res) => {
  const { userId, couponCode } = req.body || {};
  if (!userId || !couponCode) return res.status(400).json({ error: 'userId and couponCode required' });
  const coupon = coupons.find(c => c.code === couponCode);
  if (!coupon) return res.status(404).json({ error: 'coupon not found' });

  if (!usageRecords[userId]) usageRecords[userId] = {};
  usageRecords[userId][couponCode] = (usageRecords[userId][couponCode] || 0) + 1;
  return res.json({ message: 'usage recorded', usage: usageRecords[userId][couponCode] });
});

/**
 * Simple health & info
 */
app.get('/', (req, res) => {
  res.send(`Coupon Management Service - running ${nowISO()}`);
});

/**
 * Seed sample coupons (so reviewer can test quickly)
 */
function seedSampleCoupons() {
  const now = new Date();
  const plus30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const plus60 = new Date(now.getTime() + 60 * 24 * 3600 * 1000);

  // If coupons not previously seeded
  if (coupons.length === 0) {
    coupons.push({
      code: 'WELCOME100',
      description: '₹100 off for new users on min cart ₹500',
      discountType: 'FLAT',
      discountValue: 100,
      startDate: now.toISOString(),
      endDate: plus30.toISOString(),
      usageLimitPerUser: 1,
      eligibility: {
        allowedUserTiers: ['NEW'],
        minCartValue: 500,
        firstOrderOnly: true
      }
    });
    coupons.push({
      code: 'FESTIVE10',
      description: '10% off up to ₹200 for all users',
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountAmount: 200,
      startDate: now.toISOString(),
      endDate: plus60.toISOString(),
      eligibility: {
        minCartValue: 1000,
        excludedCategories: ['gift-cards']
      }
    });
    coupons.push({
      code: 'ELECTRO50',
      description: '₹50 off electronics on min 1 elect. item',
      discountType: 'FLAT',
      discountValue: 50,
      startDate: now.toISOString(),
      endDate: plus60.toISOString(),
      eligibility: {
        applicableCategories: ['electronics']
      }
    });
  }
}

seedSampleCoupons();

app.listen(PORT, () => {
  console.log(`Coupon service listening on port ${PORT}`);
  console.log(`Demo login: email=hire-me@anshumat.org  password=HireMe@2025!`);
});
