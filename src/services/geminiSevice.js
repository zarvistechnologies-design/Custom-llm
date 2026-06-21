const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * 3 configurable tools available to every voice agent:
 * 1. book_appointment — book a medical appointment or service visit
 * 2. check_doctor_availability — check available doctor/location slots
 * 3. get_doctors — get doctors or service locations
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
          'Book an appointment or service visit. For medical clinics include doctor_name. For OPD queue doctors, appointment_time is optional and the backend assigns a queue number. For fixed-slot doctors and service businesses like Tankro, collect a valid HH:MM AM/PM time. Call only after collecting valid YYYY-MM-DD date and customer/patient name in English.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patient_name: {
              type: SchemaType.STRING,
              description: "Patient/customer name in English (e.g. Rajesh, Priya).",
            },
            customer_name: {
              type: SchemaType.STRING,
              description: 'Alias for patient_name when this is a service booking.',
            },
            customer_phone: {
              type: SchemaType.STRING,
              description: 'Optional customer phone if explicitly provided. Otherwise the caller phone is used.',
            },
            customer_address: {
              type: SchemaType.STRING,
              description: 'Optional service address or customer address.',
            },
            patientAge: {
              type: SchemaType.INTEGER,
              description:
                'Optional. Send only if caller gave age or the clinic prompt explicitly collected it. Do not invent.',
            },
            patientLocation: {
              type: SchemaType.STRING,
              description:
                'Optional. Send only if caller gave location/city or the clinic prompt explicitly collected it, e.g. "Ara" or "Patna". Do not invent.',
            },
            patient_age: {
              type: SchemaType.INTEGER,
              description: 'Backward-compatible alias for patientAge. Optional; send only when known.',
            },
            patient_location: {
              type: SchemaType.STRING,
              description: 'Backward-compatible alias for patientLocation. Optional; send only when known.',
            },
            patient_type: {
              type: SchemaType.STRING,
              description:
                'Medical bookings only. Use "new" for first-time/new patients. Use "follow_up" for old/repeat/review/second consultation patients.',
            },
            doctor_name: {
              type: SchemaType.STRING,
              description: 'Doctor full name in English for medical bookings. Leave empty for service bookings.',
            },
            location_id: {
              type: SchemaType.STRING,
              description: 'Optional service location ID for non-medical bookings.',
            },
            location_name: {
              type: SchemaType.STRING,
              description: 'Service location, branch, or city/district name for non-medical bookings.',
            },
            district: {
              type: SchemaType.STRING,
              description: 'District/city for service bookings, e.g. Chennai or Coimbatore.',
            },
            service_type: {
              type: SchemaType.STRING,
              description: 'Service type such as tank_cleaning, roof_care, callback, complaint, or other.',
            },
            property_type: {
              type: SchemaType.STRING,
              description: 'Optional property type for service bookings, e.g. apartment, house, office.',
            },
            tank_capacity_litres: {
              type: SchemaType.INTEGER,
              description: 'Optional tank capacity in litres for Tankro bookings.',
            },
            purpose: {
              type: SchemaType.STRING,
              description: 'Short reason or purpose for the booking.',
            },
            notes: {
              type: SchemaType.STRING,
              description: 'Optional notes to save with the booking.',
            },
            appointment_date: {
              type: SchemaType.STRING,
              description: 'Date in YYYY-MM-DD format.',
            },
            appointment_time: {
              type: SchemaType.STRING,
              description: 'Optional for OPD queue medical bookings. Required for fixed-slot doctors and service bookings. Time as "HH:MM AM/PM", e.g. "02:00 PM".',
            },
          },
          required: ['patient_name', 'appointment_date'],
        },
      },

      // ============================================================
      // TOOL 2: CHECK DOCTOR AVAILABILITY
      // ============================================================
      {
        name: 'check_doctor_availability',
        description:
          'Check available time slots for a specific doctor or service location on a given date. For medical clinics use doctor_name. For service businesses like Tankro use location_name or district. Call BEFORE booking if availability is unclear.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            doctor_name: {
              type: SchemaType.STRING,
              description: 'Doctor full name in English for medical availability checks.',
            },
            location_id: {
              type: SchemaType.STRING,
              description: 'Optional service location ID for non-medical availability checks.',
            },
            location_name: {
              type: SchemaType.STRING,
              description: 'Service location, branch, or city/district name for non-medical availability checks.',
            },
            district: {
              type: SchemaType.STRING,
              description: 'District/city for service availability checks.',
            },
            date: {
              type: SchemaType.STRING,
              description: 'Date to check in YYYY-MM-DD format.',
            },
          },
          required: ['date'],
        },
      },

      // ============================================================
      // TOOL 3: GET DOCTORS LIST
      // ============================================================
      {
        name: 'get_doctors',
        description:
          'Get the list of all doctors or service locations configured for this phone number. Use this when caller asks which doctors, specialities, branches, districts, or service locations are available.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            speciality: {
              type: SchemaType.STRING,
              description: 'Optional: filter by speciality (e.g. "Gynecologist", "Urologist"). Leave empty to get all doctors.',
            },
            district: {
              type: SchemaType.STRING,
              description: 'Optional: filter service locations by district/city.',
            },
            location_name: {
              type: SchemaType.STRING,
              description: 'Optional: filter service locations by name.',
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
