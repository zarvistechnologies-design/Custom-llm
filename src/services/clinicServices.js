const Clinic = require('../models/Clinic');

/**
 * In-memory cache: phone_number → { config, cachedAt }
 * Reduces DB hits — first call queries DB, subsequent turns use cache.
 */
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Default fallback if DB unreachable or clinic not found.
 */
const DEFAULT_CONFIG = {
  phone_number: 'default',
  name: 'Default Clinic',
  prompt:
    'You are a friendly receptionist. Reply briefly in Hindi.',
  greeting: 'नमस्ते, मैं रिसेप्शन से बोल रही हूं। कैसे मदद कर सकती हूं?',
  booking_endpoint: process.env.BOOK_APPOINTMENT_URL || '',
  availability_endpoint: process.env.AVAILABILITY_URL || null,
  doctors_endpoint: process.env.DOCTORS_URL || null,
  booking_auth_header: null,
  model: 'gemini-2.5-flash',
  temperature: 0.6,
  max_output_tokens: 1024,
  active: true,
};

/**
 * Get clinic config by phone number.
 * Cache → DB → Default fallback.
 */
async function getClinicConfig(phoneNumber) {
  if (!phoneNumber) {
    console.warn('[ClinicService] No phone, using default');
    return DEFAULT_CONFIG;
  }

  // 1. Cache check
  const cached = cache.get(phoneNumber);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    console.log(`[ClinicService] ✅ Cache HIT: ${phoneNumber}`);
    return cached.config;
  }

  // 2. DB query
  try {
    console.log(`[ClinicService] Cache MISS — DB query: ${phoneNumber}`);
    const clinic = await Clinic.findOne({ phone_number: phoneNumber, active: true }).lean();

    if (!clinic) {
      console.warn(`[ClinicService] ⚠️ No clinic for ${phoneNumber}, using default`);
      return DEFAULT_CONFIG;
    }

    console.log(`[ClinicService] ✅ Loaded: ${clinic.name}`);
    cache.set(phoneNumber, { config: clinic, cachedAt: Date.now() });
    return clinic;
  } catch (err) {
    console.error('[ClinicService] ❌ DB error, using default:', err.message);
    return DEFAULT_CONFIG;
  }
}

function clearCache(phoneNumber) {
  if (phoneNumber) {
    cache.delete(phoneNumber);
    console.log(`[ClinicService] Cache cleared: ${phoneNumber}`);
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