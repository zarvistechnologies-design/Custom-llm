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

      // ============================================================
      // SUPPORT TOOLS (Akiara / Devika)
      // ============================================================
      {
        name: 'lookup_order',
        description:
          'Look up an Akiara customer order when the caller provides an order ID. Use before warranty or purchase-specific answers when possible.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            order_id: {
              type: SchemaType.STRING,
              description: 'Order ID shared by the caller, for example AK-20984.',
            },
            customer_phone: {
              type: SchemaType.STRING,
              description: 'Caller phone number if available.',
            },
          },
          required: ['order_id'],
        },
      },
      {
        name: 'create_support_ticket',
        description:
          'Create the final support ticket. Call once near the end of every support call, whether resolved or escalated. All values must be in English.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            customer_phone: { type: SchemaType.STRING },
            customer_name: { type: SchemaType.STRING },
            order_id: { type: SchemaType.STRING },
            product: { type: SchemaType.STRING, description: 'Mini, Duo, Yume, or unknown.' },
            issue_category: {
              type: SchemaType.STRING,
              description:
                'troubleshooting, service_request, refund, warranty, live_demo, general_query, safety, or other.',
            },
            issue_description: { type: SchemaType.STRING },
            issue_summary: {
              type: SchemaType.STRING,
              description: 'Concise English summary of what happened and the outcome.',
            },
            language: { type: SchemaType.STRING, description: 'en or hi.' },
            escalated: {
              type: SchemaType.BOOLEAN,
              description:
                'True for human transfer, safety issue, unresolved issue, legal/manager request, or refund outside policy.',
            },
            priority: { type: SchemaType.STRING, description: 'normal, high, or urgent.' },
            resolution: { type: SchemaType.STRING },
            escalation_reason: { type: SchemaType.STRING },
            post_call_message_needed: { type: SchemaType.BOOLEAN },
          },
          required: ['customer_phone', 'issue_description', 'issue_summary', 'language', 'escalated', 'priority'],
        },
      },
      {
        name: 'update_support_ticket',
        description: 'Update an existing support ticket if new information appears after a ticket has already been created.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            ticket_id: { type: SchemaType.STRING },
            status: { type: SchemaType.STRING },
            priority: { type: SchemaType.STRING },
            issue_summary: { type: SchemaType.STRING },
            resolution: { type: SchemaType.STRING },
            escalation_reason: { type: SchemaType.STRING },
          },
          required: ['ticket_id'],
        },
      },
      {
        name: 'transfer_to_service_agent',
        description:
          'Request handoff to a human service agent for home service, warranty registration, return/refund, safety, manager request, legal, or unresolved issue.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            customer_phone: { type: SchemaType.STRING },
            order_id: { type: SchemaType.STRING },
            product: { type: SchemaType.STRING },
            language: { type: SchemaType.STRING },
            reason: { type: SchemaType.STRING },
            priority: { type: SchemaType.STRING },
            handoff_summary: {
              type: SchemaType.STRING,
              description: 'Short English context for the human agent.',
            },
          },
          required: ['customer_phone', 'reason', 'priority', 'handoff_summary'],
        },
      },
      {
        name: 'send_post_call_message',
        description:
          'Queue a WhatsApp or SMS message after the call, such as a troubleshooting video, Calendly link, or follow-up note. Never read URLs aloud during the call.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            customer_phone: { type: SchemaType.STRING },
            channel: { type: SchemaType.STRING, description: 'whatsapp or sms.' },
            message: { type: SchemaType.STRING },
            purpose: {
              type: SchemaType.STRING,
              description: 'video_link, calendly_link, policy_info, follow_up, or other.',
            },
            link_url: { type: SchemaType.STRING },
            video_url: { type: SchemaType.STRING },
          },
          required: ['customer_phone', 'channel', 'message', 'purpose'],
        },
      },
      {
        name: 'check_demo_slots',
        description: 'Check available live-demo slots before booking if slot lookup is configured.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            preferred_date: { type: SchemaType.STRING, description: 'Preferred date in YYYY-MM-DD format.' },
            preferred_time: { type: SchemaType.STRING },
            customer_phone: { type: SchemaType.STRING },
          },
          required: [],
        },
      },
      {
        name: 'book_live_demo',
        description:
          'Book a free Akiara live demo after collecting name, email, and preferred date/time one at a time.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            customer_name: { type: SchemaType.STRING },
            customer_email: { type: SchemaType.STRING },
            customer_phone: { type: SchemaType.STRING },
            preferred_date: { type: SchemaType.STRING, description: 'Preferred date in YYYY-MM-DD format.' },
            preferred_time: { type: SchemaType.STRING },
            product: { type: SchemaType.STRING },
          },
          required: ['customer_name', 'customer_email', 'preferred_date', 'preferred_time'],
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
