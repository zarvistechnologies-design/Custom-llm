const axios = require('axios');
const { getClinicConfig } = require('../services/clinicServices');
const { buildModel } = require('../services/geminiSevice');

// ============================================================
// IST DATE HELPER
// ============================================================
function getISTDateInfo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const parts = formatter.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tParts = formatter.formatToParts(tomorrow);
  const tGet = (type) => tParts.find((p) => p.type === type)?.value || '';

  const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const daParts = formatter.formatToParts(dayAfter);
  const daGet = (type) => daParts.find((p) => p.type === type)?.value || '';

  return {
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    time12: `${get('hour')}:${get('minute')} ${(get('dayPeriod') || '').toUpperCase() || (parseInt(get('hour')) < 12 ? 'AM' : 'PM')}`,
    fullText: `${get('weekday')}, ${get('day')}/${get('month')}/${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod') || 'PM'}`,
    tomorrow: { date: `${tGet('year')}-${tGet('month')}-${tGet('day')}`, weekday: tGet('weekday') },
    dayAfter: { date: `${daGet('year')}-${daGet('month')}-${daGet('day')}`, weekday: daGet('weekday') },
  };
}

// ============================================================
// ⚡ LANGUAGE DETECTION — last user message se language detect karo
// ============================================================
function detectLanguage(text) {
  if (!text) return 'hi';

  // Devanagari script characters
  const devanagariChars = (text.match(/[\u0900-\u097F]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalChars = devanagariChars + latinChars;

  if (totalChars === 0) return 'hi';

  const devanagariRatio = devanagariChars / totalChars;

  // Marathi-specific words/patterns
  const marathiKeywords = /आहे|पाहिजे|कधी|काय|कोण|वाजता|बरोबर|उद्या|परवा|नक्की|माफ करा|सांगाल|आपले|कृपया/;
  const isMarathi = marathiKeywords.test(text);

  if (devanagariRatio > 0.5) {
    return isMarathi ? 'mr' : 'hi';
  }

  // Mostly Latin → English
  if (devanagariRatio < 0.2) {
    return 'en';
  }

  // Mixed (Hinglish/Marglish) — default to Hindi
  return 'hi';
}

// ============================================================
// ⚡ FILLER MESSAGES per language (random pick for variety)
// ============================================================
const FILLERS = {
  hi: [
    'एक पल, आपका अपॉइंटमेंट बुक कर रही हूं...',
    'बस एक मिनट, आपका नंबर लगा रही हूं...',
  ],
  mr: [
    'एक मिनिट, तुमचा नंबर लावत आहे...',
    'थांबा, बुक करत आहे...',
    'ठीक आहे, अपॉइंटमेंट लावत आहे...',
  ],
  en: [
    'One moment, booking your appointment...',
    'Just a second, getting your slot booked...',
    'Sure, processing your booking now...',
  ],
};

function getFillerForLanguage(lang) {
  const list = FILLERS[lang] || FILLERS.hi;
  return list[Math.floor(Math.random() * list.length)];
}

// ============================================================
// ⚡ AVAILABILITY-CHECK FILLER MESSAGES per language
// ============================================================
const AVAILABILITY_FILLERS = {
  hi: [
    'एक पल, उपलब्धता चेक कर रही हूं...',
    'रुकिए, स्लॉट्स देख रही हूं...',
  ],
  mr: [
    'एक मिनिट, उपलब्धता तपासत आहे...',
    'थांबा, स्लॉट तपासत आहे...',
  ],
  en: [
    'One moment, checking availability...',
    'Just a second, let me check the slots...',
  ],
};

function getAvailabilityFillerForLanguage(lang) {
  const list = AVAILABILITY_FILLERS[lang] || AVAILABILITY_FILLERS.hi;
  return list[Math.floor(Math.random() * list.length)];
}

function normalizePatientAge(value) {
  const age = Number(value);
  return Number.isFinite(age) && age > 0 ? age : null;
}

function normalizePatientLocation(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizePatientType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  if (
    raw.includes('follow') ||
    raw.includes('old') ||
    raw.includes('repeat') ||
    raw.includes('review') ||
    raw.includes('revisit') ||
    raw.includes('second')
  ) {
    return 'follow_up';
  }

  if (raw.includes('new') || raw.includes('first') || raw.includes('fresh')) {
    return 'new';
  }

  return '';
}

function extractBookingResult(responseData) {
  const data = responseData?.data || responseData?.appointment || responseData || {};
  return {
    queueNumber: data.queueNumber || data.queue_number || responseData?.queueNumber || responseData?.queue_number || null,
    patientType: data.patientType || data.patient_type || responseData?.patientType || responseData?.patient_type || null,
    appointmentId: data.appointmentId || data.id || data._id || responseData?.appointmentId || null,
  };
}

function deriveAvailabilityEndpoint(bookingEndpoint) {
  if (!bookingEndpoint || typeof bookingEndpoint !== 'string') return null;

  if (bookingEndpoint.endsWith('/api/tankro/book')) {
    return bookingEndpoint.replace(/\/api\/tankro\/book$/, '/api/tankro/availability');
  }

  if (bookingEndpoint.endsWith('/api/book-appointment')) {
    return bookingEndpoint.replace(/\/api\/book-appointment$/, '/api/availability');
  }

  if (bookingEndpoint.endsWith('/api/availability/book')) {
    return bookingEndpoint.replace(/\/api\/availability\/book$/, '/api/availability');
  }

  return null;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function isTankroEndpoint(endpoint) {
  return /\/api\/tankro(\/|$)/i.test(String(endpoint || ''));
}

function resolveEndpoint(endpoint, callContext) {
  let resolved = String(endpoint || '').trim();
  const phone = encodeURIComponent(callContext.to_phone || '');

  resolved = resolved
    .replace(/\{\{\s*(agent_number|assignedPhoneNumber|clinic_phone|to_phone)\s*\}\}/gi, phone)
    .replace(/\{(agent_number|assignedPhoneNumber|clinic_phone|to_phone)\}/gi, phone);

  if (phone && /\/by-phone\/?$/i.test(resolved)) {
    resolved = `${resolved.replace(/\/$/, '')}/${phone}`;
  }

  return resolved;
}

function normalizeServiceType(value) {
  const service = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!service) return 'tank_cleaning';
  if (['tank_cleaning', 'roof_care', 'callback', 'complaint', 'other'].includes(service)) return service;
  if (service.includes('roof')) return 'roof_care';
  if (service.includes('complaint')) return 'complaint';
  if (service.includes('call')) return 'callback';
  if (service.includes('tank') || service.includes('clean')) return 'tank_cleaning';
  return 'other';
}

// ============================================================
// TOOL EXECUTOR — handles all 3 tools
// ============================================================
async function executeTool(name, args, callContext) {
  console.log(`[TOOL CALL] ${name}`, args);

  const headers = { 'Content-Type': 'application/json' };
  if (callContext.booking_auth_header) {
    headers['Authorization'] = callContext.booking_auth_header;
  }

  if (name === 'book_appointment') {
    try {
      const bookingEndpoint = resolveEndpoint(callContext.booking_endpoint, callContext);
      const patientAge = normalizePatientAge(args.patientAge ?? args.patient_age ?? args.age);
      const patientLocation = normalizePatientLocation(
        args.patientLocation ?? args.patient_location ?? args.location ?? args.city
      );
      const patientType = normalizePatientType(
        args.patient_type ?? args.patientType ?? args.visit_type ?? args.patient_category ?? args.purpose ?? args.notes
      );
      const appointmentDate = firstText(args.appointment_date, args.date);
      const appointmentTime = firstText(args.appointment_time, args.time);

      if (isTankroEndpoint(bookingEndpoint)) {
        const payload = {
          assignedPhoneNumber: callContext.to_phone,
          customerName: firstText(args.customer_name, args.patient_name, args.name),
          customerPhone: firstText(args.customer_phone, args.patient_phone, callContext.from_phone),
          customerEmail: firstText(args.customer_email, args.email),
          customerAddress: firstText(args.customer_address, args.address, args.patientLocation, args.patient_location),
          locationId: firstText(args.location_id, args.locationId),
          locationName: firstText(args.location_name, args.locationName, args.district, args.city),
          district: firstText(args.district, args.location_name, args.locationName, args.city),
          propertyType: firstText(args.property_type, args.propertyType),
          serviceType: normalizeServiceType(firstText(args.service_type, args.serviceType, args.purpose)),
          tankCapacityLitres: firstNumber(args.tank_capacity_litres, args.tankCapacityLitres, args.tank_capacity),
          date: appointmentDate,
          time: appointmentTime,
          notes: firstText(args.notes, args.purpose),
          source: 'millis_ai_auto',
          callId: callContext.call_id,
          metadata: {
            session_id: callContext.session_id,
            from_number: callContext.from_phone,
            to_number: callContext.to_phone,
            clinic_name: callContext.clinic_name,
          },
        };

        console.log('[TANKRO_BOOKING] Endpoint:', bookingEndpoint);
        console.log('[TANKRO_BOOKING] Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(bookingEndpoint, payload, {
          headers,
          timeout: 8000,
        });

        console.log('[TANKRO_BOOKING] âœ… Response:', response.data);
        return { success: true, confirmation: response.data };
      }

      const payload = {
        patientName: firstText(args.patient_name, args.customer_name),
        doctorName: args.doctor_name,
        date: appointmentDate,
        time: appointmentTime,
        patientPhone: callContext.from_phone,
        assignedPhoneNumber: callContext.to_phone,
        patient_name: firstText(args.patient_name, args.customer_name),
        doctor_name: args.doctor_name,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime,
        patient_phone: callContext.from_phone,
        clinic_phone: callContext.to_phone,
        FromPhone: callContext.from_phone,
        ToPhone: callContext.to_phone,
        from_phone: callContext.from_phone,
        to_phone: callContext.to_phone,
        session_id: callContext.session_id,
        call_id: callContext.call_id,
        clinic_name: callContext.clinic_name,
        purpose: firstText(args.purpose, args.notes) || undefined,
      };

      if (patientType) {
        payload.patientType = patientType;
        payload.patient_type = patientType;
      }

      if (patientAge !== null) {
        payload.patientAge = patientAge;
        payload.age = patientAge;
      }

      if (patientLocation) {
        payload.patientLocation = patientLocation;
        payload.location = patientLocation;
        payload.city = patientLocation;
      }

      console.log('[BOOK_APPOINTMENT] Endpoint:', bookingEndpoint);
      console.log('[BOOK_APPOINTMENT] Payload:', JSON.stringify(payload, null, 2));

      const response = await axios.post(bookingEndpoint, payload, {
        headers,
        timeout: 8000,
      });

      console.log('[BOOK_APPOINTMENT] ✅ Response:', response.data);
      const bookingResult = extractBookingResult(response.data);
      return {
        success: true,
        confirmation: response.data,
        queueNumber: bookingResult.queueNumber,
        patientType: bookingResult.patientType,
        appointmentId: bookingResult.appointmentId,
        instruction: bookingResult.queueNumber
          ? `Booking successful. Tell the caller clearly: aapka number ${bookingResult.queueNumber} hai. Do not say "queue number".`
          : 'Booking successful. Confirm the appointment details.',
      };
    } catch (err) {
      console.error('[BOOK_APPOINTMENT] ❌ Error:', err.message);
      if (err.response) {
        console.error('[BOOK_APPOINTMENT] Status:', err.response.status);
        console.error('[BOOK_APPOINTMENT] Endpoint said:', JSON.stringify(err.response.data, null, 2));
      }
      return {
        success: false,
        error: err.message,
        endpoint_response: err.response?.data,
        instruction: 'Booking FAILED. Tell caller about technical issue. Do NOT confirm.',
      };
    }
  }

  if (name === 'check_doctor_availability') {
    try {
      const availabilityEndpoint = resolveEndpoint(
        callContext.availability_endpoint || deriveAvailabilityEndpoint(callContext.booking_endpoint),
        callContext
      );

      if (!availabilityEndpoint) {
        console.error('[CHECK_AVAILABILITY] Missing availability endpoint', {
          availability_endpoint: callContext.availability_endpoint,
          booking_endpoint: callContext.booking_endpoint,
        });
        return { success: false, error: 'Availability endpoint not configured.' };
      }

      if (isTankroEndpoint(availabilityEndpoint)) {
        const params = {
          assignedPhoneNumber: callContext.to_phone,
          locationId: firstText(args.location_id, args.locationId) || undefined,
          locationName: firstText(args.location_name, args.locationName, args.district, args.city) || undefined,
          district: firstText(args.district, args.location_name, args.locationName, args.city) || undefined,
          date: args.date || args.appointment_date,
        };

        console.log('[TANKRO_AVAILABILITY] Endpoint:', availabilityEndpoint);
        console.log('[TANKRO_AVAILABILITY] Params:', JSON.stringify(params, null, 2));

        const response = await axios.get(availabilityEndpoint, {
          params,
          headers,
          timeout: 8000,
        });

        console.log('[TANKRO_AVAILABILITY] âœ… Response:', response.data);
        return { success: true, availability: response.data };
      }

      const payload = {
        doctorName: args.doctor_name,
        date: args.date,
        time: args.time || args.appointment_time || null,
        assignedPhoneNumber: callContext.to_phone,
        doctor_name: args.doctor_name,
        appointment_time: args.time || args.appointment_time || null,
        clinic_phone: callContext.to_phone,
        ToPhone: callContext.to_phone,
        session_id: callContext.session_id,
        clinic_name: callContext.clinic_name,
      };

      console.log('[CHECK_AVAILABILITY] Endpoint:', availabilityEndpoint);
      console.log('[CHECK_AVAILABILITY] Payload:', JSON.stringify(payload, null, 2));

      let response;
      try {
        response = await axios.post(availabilityEndpoint, payload, {
          headers,
          timeout: 8000,
        });
      } catch (postErr) {
        const status = postErr.response?.status;
        if (![404, 405].includes(status)) {
          throw postErr;
        }

        response = await axios.get(availabilityEndpoint, {
          params: {
            assignedPhoneNumber: payload.assignedPhoneNumber,
            doctorName: payload.doctorName,
            date: payload.date,
            time: payload.time,
          },
          headers,
          timeout: 8000,
        });
      }

      console.log('[CHECK_AVAILABILITY] ✅ Response:', response.data);
      return { success: true, availability: response.data };
    } catch (err) {
      console.error('[CHECK_AVAILABILITY] ❌ Error:', err.message);
      return {
        success: false,
        error: err.message,
        endpoint_response: err.response?.data,
        instruction: 'Could not fetch availability.',
      };
    }
  }

  if (name === 'get_doctors') {
    try {
      const doctorsEndpoint = resolveEndpoint(callContext.doctors_endpoint, callContext);
      if (!doctorsEndpoint) {
        return { success: false, error: 'Doctors endpoint not configured.' };
      }
      const payload = {
        speciality: args.speciality || null,
        assignedPhoneNumber: callContext.to_phone,
        clinic_phone: callContext.to_phone,
        ToPhone: callContext.to_phone,
        session_id: callContext.session_id,
        clinic_name: callContext.clinic_name,
      };

      if (isTankroEndpoint(doctorsEndpoint)) {
        console.log('[TANKRO_LOCATIONS] Endpoint:', doctorsEndpoint);
        const response = await axios.get(doctorsEndpoint, {
          params: {
            district: firstText(args.district),
            locationName: firstText(args.location_name, args.locationName),
          },
          headers,
          timeout: 8000,
        });
        console.log('[TANKRO_LOCATIONS] âœ… Response:', response.data);
        return { success: true, doctors: response.data, locations: response.data };
      }

      console.log('[GET_DOCTORS] Endpoint:', doctorsEndpoint);
      console.log('[GET_DOCTORS] Payload:', JSON.stringify(payload, null, 2));
      const response = await axios.post(doctorsEndpoint, payload, {
        headers,
        timeout: 8000,
      });
      console.log('[GET_DOCTORS] ✅ Response:', response.data);
      return { success: true, doctors: response.data };
    } catch (err) {
      console.error('[GET_DOCTORS] ❌ Error:', err.message);
      return {
        success: false,
        error: err.message,
        endpoint_response: err.response?.data,
        instruction: 'Could not fetch doctors list.',
      };
    }
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

// ============================================================
// STREAMING HELPER (final stream — closes audio)
// ============================================================
function streamTextToMillis(ws, streamId, text) {
  const sentences = text
    .split(/(?<=[।?!.])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) {
    ws.send(JSON.stringify({
      type: 'stream_response',
      data: { stream_id: streamId, content: text || '...', flush: true, end_of_stream: true },
    }));
    return;
  }

  if (sentences.length === 1) {
    ws.send(JSON.stringify({
      type: 'stream_response',
      data: { stream_id: streamId, content: sentences[0], flush: true, end_of_stream: true },
    }));
    return;
  }

  sentences.forEach((sentence, idx) => {
    const isLast = idx === sentences.length - 1;
    ws.send(JSON.stringify({
      type: 'stream_response',
      data: {
        stream_id: streamId,
        content: sentence + (isLast ? '' : ' '),
        flush: true,
        end_of_stream: isLast,
      },
    }));
  });
}

// ============================================================
// ⚡ FILLER STREAM — keeps stream OPEN (more audio coming)
// ============================================================
function streamFillerToMillis(ws, streamId, text) {
  console.log('[FILLER] Sending:', text);
  ws.send(JSON.stringify({
    type: 'stream_response',
    data: {
      stream_id: streamId,
      content: text + ' ',
      flush: true,
      end_of_stream: false,  // ⚡ stream OPEN — more audio appending
    },
  }));
}

// ============================================================
// WEBSOCKET CONNECTION HANDLER
// ============================================================
function handleConnection(ws, req) {
  const expectedAuth = process.env.WS_SECRET;
  const authHeader = req.headers.authorization || '';
  if (expectedAuth && authHeader !== `Bearer ${expectedAuth}`) {
    console.warn('Unauthorized WS attempt');
    ws.close(1008, 'Unauthorized');
    return;
  }

  console.log('Millis AI connected');

  const callContext = {
    from_phone: null,
    to_phone: null,
    session_id: null,
    call_id: null,
    voip_provider: null,
    direction: null,
    metadata: {},
    clinic_name: null,
    booking_endpoint: null,
    availability_endpoint: null,
    doctors_endpoint: null,
    booking_auth_header: null,
  };

  let clinicConfig = null;
  let model = null;
  let bookingCompleted = false;
  let lastBookingQueueNumber = null;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received:', message.type);

      // ----------------------------------------------------------
      // START_CALL
      // ----------------------------------------------------------
      if (message.type === 'start_call') {
        const d = message.data || {};
        console.log('[START_CALL] Raw payload:', JSON.stringify(message, null, 2));

        const voip = d.voip || {};
        callContext.from_phone =
          voip.from || d.from_phone || d.from || d.FromPhone || d.fromPhone || null;
        callContext.to_phone =
          voip.to || d.to_phone || d.to || d.ToPhone || d.toPhone || d.assignedPhoneNumber || null;
        callContext.session_id = d.session_id || null;
        callContext.call_id = d.call_sid || d.call_id || null;
        callContext.voip_provider = voip.provider || null;
        callContext.direction = voip.direction || null;
        callContext.metadata = d.metadata || {};

        console.log('[START_CALL] Captured:', callContext);

        clinicConfig = await getClinicConfig(callContext.to_phone);
        callContext.clinic_name = clinicConfig.name;
        callContext.booking_endpoint = clinicConfig.booking_endpoint;
        callContext.availability_endpoint = clinicConfig.availability_endpoint;
        callContext.doctors_endpoint = clinicConfig.doctors_endpoint;
        callContext.booking_auth_header = clinicConfig.booking_auth_header;

        console.log(`[START_CALL] Loaded clinic: ${clinicConfig.name}`);

        model = buildModel(clinicConfig);

        ws.send(JSON.stringify({
          type: 'stream_response',
          data: {
            stream_id: d.stream_id,
            content: clinicConfig.greeting,
            flush: true,
            end_of_stream: true,
          },
        }));
        return;
      }

      // ----------------------------------------------------------
      // STREAM_REQUEST
      // ----------------------------------------------------------
      if (message.type === 'stream_request') {
        if (!clinicConfig || !model) {
          console.error('[STREAM_REQUEST] No clinic loaded — start_call missed?');
          return;
        }

        const streamId = message.data?.stream_id ?? message.stream_id;
        const transcript = message.data?.transcript;

        if (!Array.isArray(transcript) || transcript.length === 0) return;

        const last = transcript[transcript.length - 1];
        const userMessage = last?.role === 'user' ? last.content || '' : '';
        if (!userMessage) return;

        console.log('User said:', userMessage);

        // ⚡ Detect language from user message
        const userLang = detectLanguage(userMessage);
        console.log(`[LANG] Detected: ${userLang}`);

        const ist = getISTDateInfo();
        const dateTimeContext = `[SYSTEM CONTEXT - DO NOT SPEAK ALOUD]
Today's date: ${ist.isoDate}
Today's weekday: ${ist.weekday}
Current time (IST): ${ist.time12}
Tomorrow's date: ${ist.tomorrow.date}
Tomorrow's weekday: ${ist.tomorrow.weekday}
Day after tomorrow's date: ${ist.dayAfter.date}
Day after tomorrow's weekday: ${ist.dayAfter.weekday}

Caller phone (FromPhone): ${callContext.from_phone || 'unknown'}
Clinic phone (ToPhone): ${callContext.to_phone || 'unknown'}
Clinic: ${clinicConfig.name}
Booking completed this call: ${bookingCompleted}
Last appointment number this call: ${lastBookingQueueNumber || 'none'}

⚠️ Reply per system prompt language. Time/date in user's language (e.g. Hindi: "सुबह दस बजे"), never raw English numbers.

⚠️ IMPORTANT: If "Booking completed this call: true" — DO NOT call book_appointment again. Just briefly reconfirm and end gracefully.

⚠️ When generating confirmation after booking, DO NOT include filler phrases like "बुक कर रही हूं" — system already speaks a filler before booking. Go directly to final confirmation.

⚠️ When generating the answer after check_doctor_availability, DO NOT include filler phrases like "चेक कर रही हूं" or "देख रही हूं" — system already speaks a filler before checking. Go directly to the available slots/result.

⚠️ If book_appointment tool response contains queueNumber, ALWAYS tell the caller that exact appointment number as "aapka number [number] hai".

Do not speak the words "queue number" to the caller. For appointments, say "aapka number [number] hai".

Tools available:
- book_appointment: book a new appointment or service visit (ONLY use after collecting date and name. For OPD queue doctors, time is optional and queue number is assigned by the API. For fixed-slot doctors and Tankro, collect time; for Tankro include district/location and purpose/service details)
- check_doctor_availability: check available slots for a doctor or service location on a date
- get_doctors: get list of doctors, branches, districts, or service locations configured for this phone number`;

        let history = transcript.slice(0, -1).map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content || '' }],
        }));
        if (history.length > 0 && history[0].role === 'model') {
          history = [{ role: 'user', parts: [{ text: '[Call connected]' }] }, ...history];
        }

        try {
          const chat = model.startChat({ history });
          const augmentedMessage = `${dateTimeContext}\n\nUser said: ${userMessage}`;

          let result = await chat.sendMessage(augmentedMessage);
          let response = result.response;

          // ============================================================
          // Tool call loop with FORCED filler + duplicate handling
          // ============================================================
          let safetyCounter = 0;
          let shortCircuitTriggered = false;
          let fillerSent = false;

          while (safetyCounter < 5) {
            safetyCounter++;
            const functionCalls = response.functionCalls();
            if (!functionCalls || functionCalls.length === 0) break;

            console.log(`[LOOP ${safetyCounter}] Function calls:`, functionCalls);

            // ============================================================
            // ⚡ SHORT-CIRCUIT: Duplicate booking attempt
            // ============================================================
            const hasDuplicateBooking = functionCalls.some(
              (call) => call.name === 'book_appointment' && bookingCompleted
            );

            if (hasDuplicateBooking) {
              console.log('[SKIP DUPLICATE] Booking already done — direct confirmation');
              const text = lastBookingQueueNumber
                ? `Ji haan, aapka appointment book ho gaya hai. Aapka number ${lastBookingQueueNumber} hai. Dhanyavaad!`
                : 'Ji haan, aapka appointment book ho gaya hai. Dhanyavaad!';
              streamTextToMillis(ws, streamId, text);
              shortCircuitTriggered = true;
              break;
            }

            // ============================================================
            // ⚡ FORCED FILLER — Tool call hone se PEHLE bolo
            // Tankro endpoints get a fixed filler; others use language-detected filler.
            // Booking takes priority; otherwise check for availability check.
            // ============================================================
            const hasNewBooking = functionCalls.some(
              (call) => call.name === 'book_appointment' && !bookingCompleted
            );

            const hasAvailabilityCheck = functionCalls.some(
              (call) => call.name === 'check_doctor_availability'
            );

            if (hasNewBooking && !fillerSent) {
              const bookingEndpoint = resolveEndpoint(callContext.booking_endpoint, callContext);
              const filler = isTankroEndpoint(bookingEndpoint)
                ? 'एक मिनट, आपकी बुकिंग कर रही हूं...'
                : getFillerForLanguage(userLang);
              streamFillerToMillis(ws, streamId, filler);
              fillerSent = true;
            } else if (hasAvailabilityCheck && !fillerSent) {
              const filler = getAvailabilityFillerForLanguage(userLang);
              streamFillerToMillis(ws, streamId, filler);
              fillerSent = true;
            }

            // ============================================================
            // Normal tool execution
            // ============================================================
            const functionResponses = [];
            for (const call of functionCalls) {
              const toolResult = await executeTool(call.name, call.args, callContext);

              if (call.name === 'book_appointment') {
                if (toolResult.success) {
                  bookingCompleted = true;
                  if (toolResult.queueNumber) {
                    lastBookingQueueNumber = toolResult.queueNumber;
                  }
                  console.log('[BOOKING] ✅ Marked as completed');
                } else {
                  console.warn('[BOOKING] ❌ Real failure:', toolResult.error);
                }
              }

              functionResponses.push({
                functionResponse: { name: call.name, response: toolResult },
              });
            }

            result = await chat.sendMessage(functionResponses);
            response = result.response;
          }

          if (shortCircuitTriggered) {
            return;
          }

          let text = '';
          try {
            text = response.text();
          } catch (e) {
            console.warn('response.text() failed:', e.message);
          }
          if (!text || text.trim() === '') {
            text = 'माफ कीजिए, कृपया फिर से बताएंगे?';
          }

          console.log('Sending to Millis (streamed):', text);
          streamTextToMillis(ws, streamId, text);
        } catch (error) {
          console.error('Gemini error:', error);
          ws.send(JSON.stringify({
            type: 'stream_response',
            data: {
              stream_id: streamId,
              content: 'माफ कीजिए, कृपया फिर से बताएंगे?',
              flush: true,
              end_of_stream: true,
            },
          }));
        }
      }

      if (message.type === 'interrupt') {
        console.log('[INTERRUPT] stream_id:', message.stream_id);
      }

      if (message.type === 'playback_finished') {
        console.log('[PLAYBACK_FINISHED] stream_id:', message.data?.stream_id);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () =>
    console.log(`Millis disconnected (${callContext.clinic_name || 'no clinic'})`)
  );
  ws.on('error', (e) => console.error('WS error:', e));
}

module.exports = { handleConnection };
