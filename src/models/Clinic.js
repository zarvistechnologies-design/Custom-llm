const mongoose = require('mongoose');

/**
 * Clinic Schema
 *
 * Each clinic identified by phone_number (the number callers dial).
 * Prompt is a single string field — edit in MongoDB Compass.
 */
const clinicSchema = new mongoose.Schema(
  {
    phone_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true },

    // Full system prompt as plain string
    prompt: { type: String, required: true },

    // First message agent speaks when call connects
    greeting: { type: String, required: true },

    // ========== TOOL ENDPOINTS ==========
    booking_endpoint: { type: String, required: true },
    availability_endpoint: { type: String, default: null },
    doctors_endpoint: { type: String, default: null },

    // Optional auth header for all endpoints
    booking_auth_header: { type: String, default: null },

    // Gemini config
    model: { type: String, default: 'gemini-2.5-flash' },
    temperature: { type: Number, default: 0.6 },
    max_output_tokens: { type: Number, default: 1024 },

    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'clinics',
  }
);

module.exports = mongoose.model('Clinic', clinicSchema);