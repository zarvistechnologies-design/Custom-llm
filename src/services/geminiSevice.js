const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * 3 Tools available to all clinics:
 * 1. book_appointment — book a new appointment
 * 2. check_doctor_availability — check available slots for a doctor on a date
 * 3. get_doctors — get list of all doctors with their info
 *
 * Clinic-specific details (which doctors, hours, validation rules) come
 * from the system prompt stored in DB.
 */
const tools = [
  {
    functionDeclarations: [
      // ============================================================
      // TOOL 1: BOOK APPOINTMENT
      // ============================================================
      {
        name: 'book_appointment',
        description:
          'Book a medical appointment for the patient. Call only after collecting valid YYYY-MM-DD date (doctor available that day), valid HH:MM AM/PM time within doctor hours, and patient name in English.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patient_name: {
              type: SchemaType.STRING,
              description: "Patient's name in English (e.g. Rajesh, Priya).",
            },
            doctor_name: {
              type: SchemaType.STRING,
              description: 'Doctor full name in English (as specified in system prompt).',
            },
            appointment_date: {
              type: SchemaType.STRING,
              description: 'Date in YYYY-MM-DD format.',
            },
            appointment_time: {
              type: SchemaType.STRING,
              description: 'Time as "HH:MM AM/PM", e.g. "02:00 PM".',
            },
          },
          required: ['patient_name', 'doctor_name', 'appointment_date', 'appointment_time'],
        },
      },

      // ============================================================
      // TOOL 2: CHECK DOCTOR AVAILABILITY
      // ============================================================
      {
        name: 'check_doctor_availability',
        description:
          'Check available time slots for a specific doctor on a given date. Use this when caller asks "kya time available hai?", "kab free hai doctor?", "konse slots khali hain?", etc. Call BEFORE booking if availability is unclear.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            doctor_name: {
              type: SchemaType.STRING,
              description: 'Doctor full name in English (e.g. "Ashish Verma").',
            },
            date: {
              type: SchemaType.STRING,
              description: 'Date to check in YYYY-MM-DD format.',
            },
          },
          required: ['doctor_name', 'date'],
        },
      },

      // ============================================================
      // TOOL 3: GET DOCTORS LIST
      // ============================================================
      {
        name: 'get_doctors',
        description:
          'Get the list of all doctors at this clinic with their specialities and timings. Use this when caller asks "kaun-kaun doctor hain?", "doctors ki list batao", "kaunsi speciality available hai?", or when caller is unsure which doctor to book.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            speciality: {
              type: SchemaType.STRING,
              description: 'Optional: filter by speciality (e.g. "Gynecologist", "Urologist"). Leave empty to get all doctors.',
            },
          },
          required: [],
        },
      },
    ],
  },
];

/**
 * Build a Gemini model instance for a given clinic config.
 */
function buildModel(clinicConfig) {
  const generationConfig = {
    temperature: clinicConfig.temperature ?? 0.6,
    topP: 0.8,
    topK: 20,
    maxOutputTokens: clinicConfig.max_output_tokens ?? 1024,
  };

  return genAI.getGenerativeModel({
    model: clinicConfig.model || 'gemini-2.5-flash',
    systemInstruction: clinicConfig.prompt,
    generationConfig,
    tools,
  });
}

module.exports = { buildModel, tools };