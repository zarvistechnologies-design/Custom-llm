const Clinic = require('../models/Clinic');

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function normalizePhone(phone = '') {
  return String(phone).replace(/\D/g, '').slice(-10);
}

function buildPhoneLookup(phoneNumber) {
  const raw = String(phoneNumber || '').trim();
  const last10 = normalizePhone(raw);
  const variants = new Set([raw]);

  if (last10) {
    variants.add(last10);
    variants.add(`91${last10}`);
    variants.add(`+91${last10}`);
  }

  const clauses = [...variants]
    .filter(Boolean)
    .map((phone) => ({ phone_number: phone }));

  if (last10) {
    clauses.push({
      phone_number: {
        $regex: new RegExp(`${last10.split('').join('\\D*')}$`),
      },
    });
  }

  return clauses.length ? clauses : [{ phone_number: raw }];
}

const DEFAULT_CONFIG = {
  phone_number: 'default',
  name: 'Default Clinic',
  prompt: 'You are a friendly receptionist. Reply briefly in Hindi.',
  greeting: 'Namaste, main reception se bol rahi hoon. Kaise madad kar sakti hoon?',
  booking_endpoint: process.env.BOOK_APPOINTMENT_URL || '',
  availability_endpoint: process.env.AVAILABILITY_URL || null,
  doctors_endpoint: process.env.DOCTORS_URL || null,
  booking_auth_header: null,
  model: 'gemini-2.5-flash',
  temperature: 0.6,
  max_output_tokens: 1024,
  active: true,
};

async function getClinicConfig(phoneNumber) {
  if (!phoneNumber) {
    console.warn('[ClinicService] No phone, using default');
    return DEFAULT_CONFIG;
  }

  const rawPhone = String(phoneNumber).trim();
  const cacheKey = normalizePhone(rawPhone) || rawPhone;
  const cached = cache.get(cacheKey) || cache.get(rawPhone);

  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    console.log(`[ClinicService] Cache HIT: ${rawPhone}`);
    return cached.config;
  }

  try {
    console.log(`[ClinicService] Cache MISS - DB query: ${rawPhone}`);
    const clinic = await Clinic.findOne({
      active: true,
      $or: buildPhoneLookup(rawPhone),
    }).lean();

    if (!clinic) {
      console.warn(`[ClinicService] No clinic for ${rawPhone}, using default`);
      return DEFAULT_CONFIG;
    }

    console.log(`[ClinicService] Loaded: ${clinic.name}`);
    const cacheValue = { config: clinic, cachedAt: Date.now() };
    cache.set(cacheKey, cacheValue);
    cache.set(rawPhone, cacheValue);
    if (clinic.phone_number) cache.set(clinic.phone_number, cacheValue);
    return clinic;
  } catch (err) {
    console.error('[ClinicService] DB error, using default:', err.message);
    return DEFAULT_CONFIG;
  }
}

function clearCache(phoneNumber) {
  if (phoneNumber) {
    const rawPhone = String(phoneNumber).trim();
    cache.delete(rawPhone);
    cache.delete(normalizePhone(rawPhone));
    console.log(`[ClinicService] Cache cleared: ${rawPhone}`);
  } else {
    cache.clear();
    console.log('[ClinicService] All cache cleared');
  }
}

function getCacheStats() {
  const entries = [];
  cache.forEach((value, key) => {
    entries.push({
      phone_number: key,
      clinic_name: value.config.name,
      age_seconds: Math.floor((Date.now() - value.cachedAt) / 1000),
    });
  });
  return { size: cache.size, ttl_seconds: CACHE_TTL / 1000, entries };
}

module.exports = { getClinicConfig, clearCache, getCacheStats };
