const express = require('express');
const Clinic = require('../models/Clinic');
const { clearCache } = require('../services/clinicServices');

const router = express.Router();

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_SECRET || process.env.WS_SECRET;
  const authHeader = req.headers.authorization || '';

  if (!expected) {
    return res.status(500).json({ success: false, error: 'Admin secret is not configured.' });
  }

  if (authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  return next();
}

function buildPhoneQuery(phoneNumber) {
  const rawPhone = String(phoneNumber || '').trim();
  const digits = rawPhone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  const phoneVariants = [...new Set([
    rawPhone,
    digits,
    digits ? `+${digits}` : null,
    last10,
    last10 ? `+91${last10}` : null,
  ].filter(Boolean))];

  return {
    $or: [
      { phone_number: { $in: phoneVariants } },
      ...(last10 ? [{ phone_number: new RegExp(`${last10}$`) }] : []),
    ],
  };
}

function safeClinic(clinic) {
  if (!clinic) return null;

  return {
    id: String(clinic._id),
    phone_number: clinic.phone_number,
    name: clinic.name,
    tenant_id: clinic.tenant_id || null,
    bot_name: clinic.bot_name || null,
    active: clinic.active,
    greeting: clinic.greeting,
    prompt_length: (clinic.prompt || '').length,
    booking_endpoint: Boolean(clinic.booking_endpoint),
    availability_endpoint: Boolean(clinic.availability_endpoint),
    doctors_endpoint: Boolean(clinic.doctors_endpoint),
    order_lookup_endpoint: Boolean(clinic.order_lookup_endpoint),
    support_ticket_endpoint: Boolean(clinic.support_ticket_endpoint),
    transfer_endpoint: Boolean(clinic.transfer_endpoint),
    post_call_message_endpoint: Boolean(clinic.post_call_message_endpoint),
    demo_slots_endpoint: Boolean(clinic.demo_slots_endpoint),
    demo_booking_endpoint: Boolean(clinic.demo_booking_endpoint),
    createdAt: clinic.createdAt,
    updatedAt: clinic.updatedAt,
  };
}

router.use(requireAdmin);

router.get('/clinics/:phoneNumber', async (req, res) => {
  try {
    const clinic = await Clinic.findOne(buildPhoneQuery(req.params.phoneNumber)).lean();
    return res.json({ success: true, clinic: safeClinic(clinic) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/clinics', async (req, res) => {
  try {
    const payload = req.body || {};

    if (!payload.phone_number || !payload.name || !payload.prompt || !payload.greeting) {
      return res.status(400).json({
        success: false,
        error: 'phone_number, name, prompt, and greeting are required.',
      });
    }

    const { _id, createdAt, ...cleanPayload } = payload;
    const update = {
      ...cleanPayload,
      updatedAt: new Date(),
    };

    const clinic = await Clinic.findOneAndUpdate(
      { phone_number: payload.phone_number },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    clearCache(payload.phone_number);

    return res.json({ success: true, clinic: safeClinic(clinic) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/cache/clear', (req, res) => {
  clearCache(req.body?.phone_number);
  return res.json({ success: true });
});

module.exports = router;
