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

  // Marathi-specific words/patterns
  const marathiKeywords = /आहे|पाहिजे|कधी|काय|कोण|वाजता|बरोबर|उद्या|परवा|नक्की|माफ करा|सांगाल|आपले|कृपया/;
  const isMarathi = marathiKeywords.test(text);

  // Any Devanagari is a strong Hindi/Marathi signal, even when most words are
  // domain terms in English, for example "Follow up patient है".
  if (devanagariChars > 0) {
    return isMarathi ? 'mr' : 'hi';
  }

  if (latinChars > 0) {
    return 'en';
  }

  return 'hi';
}

function getConversationLanguage(transcript, fallbackText, previousLanguage) {
  // Filler is assistant speech, so keep it consistent with the most recent
  // assistant turn instead of guessing from a short/mixed user reply.
  for (let index = transcript.length - 1; index >= 0; index--) {
    const turn = transcript[index];
    if (turn?.role === 'assistant' && String(turn.content || '').trim()) {
      return detectLanguage(turn.content);
    }
  }

  return previousLanguage || detectLanguage(fallbackText);
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
    raw.includes('second') ||
    raw.includes('purana') ||
    raw.includes('dubara') ||
    raw.includes('dobara') ||
    raw.includes('पुरान') ||
    raw.includes('फॉलो') ||
    raw.includes('दोबारा') ||
    raw.includes('दुबारा') ||
    raw.includes('रिव्यू') ||
    raw.includes('पहले आ') ||
    raw.includes('पहले मिल')
  ) {
    return 'follow_up';
  }

  if (
    raw.includes('new') ||
    raw.includes('first') ||
    raw.includes('fresh') ||
    raw.includes('पहली बार') ||
    raw.includes('नया') ||
    raw.includes('नई')
  ) {
    return 'new';
  }

  return '';
}

function isQueueCapacityCheck(call, userMessage = '') {
  if (call?.name !== 'check_doctor_availability') return false;

  const args = call.args || {};
  const patientType = normalizePatientType(
    args.patient_type ??
    args.patientType ??
    args.visit_type ??
    args.patient_category ??
    args.purpose ??
    args.notes ??
    userMessage
  );
  const explicitQueueCheck = Boolean(
    args.background_check ||
    args.backgroundCheck ||
    args.queue_check ||
    args.queueCheck ||
    args.opd_queue ||
    args.opdQueue ||
    args.queueAvailability ||
    args.queue_availability
  );
  const hasSpecificTime = Boolean(firstText(args.time, args.appointment_time));

  return !hasSpecificTime && (patientType === 'follow_up' || explicitQueueCheck);
}

function isBackgroundQueueCheck(call) {
  if (call?.name !== 'check_doctor_availability') return false;
  const args = call.args || {};
  const requested = args.background_check === true || args.backgroundCheck === true;
  const hasDate = Boolean(firstText(args.date, args.appointment_date));
  const hasSpecificTime = Boolean(firstText(args.time, args.appointment_time));
  return requested && hasDate && !hasSpecificTime;
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

function pickDoctorAvailability(availabilityData, doctorName) {
  const data = availabilityData?.data || availabilityData || {};
  const doctors = Array.isArray(data.doctors)
    ? data.doctors
    : (data.doctorName || data.queueAvailability ? [data] : []);

  if (doctors.length === 0) return null;

  const cleanDoctorName = String(doctorName || '')
    .replace(/^(doctor\.?\s*|dr\.?\s*)/i, '')
    .trim()
    .toLowerCase();

  if (!cleanDoctorName) return doctors[0];

  return doctors.find((doctor) => {
    const name = String(doctor.doctorName || doctor.name || '')
      .replace(/^(doctor\.?\s*|dr\.?\s*)/i, '')
      .trim()
      .toLowerCase();
    return name.includes(cleanDoctorName) || cleanDoctorName.includes(name);
  }) || doctors[0];
}

function extractFollowUpQueueAvailability(availabilityData, doctorName) {
  const flat = availabilityData?.data || availabilityData || {};
  if (
    Object.prototype.hasOwnProperty.call(flat, 'booked') &&
    Object.prototype.hasOwnProperty.call(flat, 'followUpQueueRemaining')
  ) {
    const remaining = Number(flat.followUpQueueRemaining);
    return {
      remaining: Number.isFinite(remaining) ? remaining : 0,
      canBook: flat.canBookFollowUp !== false && flat.full !== true && remaining > 0,
      booked: Number(flat.followUpBooked || 0),
      capacity: Number(flat.followUpCapacity || 0),
      totalBooked: Number(flat.booked || 0),
      doctor: doctorName || '',
    };
  }

  const doctorAvailability = pickDoctorAvailability(availabilityData, doctorName);
  if (!doctorAvailability) return null;

  const followUp = doctorAvailability.queueAvailability?.followUp;
  const remaining = Number(
    doctorAvailability.followUpQueueRemaining ??
    followUp?.remaining
  );

  if (!Number.isFinite(remaining)) return null;

  const canBook = typeof doctorAvailability.canBookFollowUp === 'boolean'
    ? doctorAvailability.canBookFollowUp
    : (typeof followUp?.canBook === 'boolean' ? followUp.canBook : remaining > 0);

  return {
    remaining,
    canBook,
    booked: Number(followUp?.booked),
    capacity: Number(followUp?.capacity),
    totalBooked: Array.isArray(doctorAvailability.bookedSlots)
      ? doctorAvailability.bookedSlots.length
      : Number(doctorAvailability.bookedCount || 0),
    doctor: doctorAvailability.doctorName || doctorAvailability.name || doctorName || '',
  };
}

async function fetchMedicalAvailability({ args, callContext, headers, appointmentDate, appointmentTime }) {
  const availabilityEndpoint = resolveEndpoint(
    callContext.availability_endpoint || deriveAvailabilityEndpoint(callContext.booking_endpoint),
    callContext
  );

  if (!availabilityEndpoint) {
    return { success: false, error: 'Availability endpoint not configured.' };
  }

  const payload = {
    doctorName: args.doctor_name,
    date: appointmentDate,
    time: appointmentTime || null,
    assignedPhoneNumber: callContext.to_phone,
    doctor_name: args.doctor_name,
    appointment_time: appointmentTime || null,
    patient_type: args.patient_type || args.patientType || null,
    clinic_phone: callContext.to_phone,
    ToPhone: callContext.to_phone,
    session_id: callContext.session_id,
    clinic_name: callContext.clinic_name,
  };

  try {
    const response = await axios.post(availabilityEndpoint, payload, {
      headers,
      timeout: 8000,
    });
    return { success: true, availability: response.data };
  } catch (postErr) {
    const status = postErr.response?.status;
    if (![404, 405].includes(status)) {
      throw postErr;
    }

    const response = await axios.get(availabilityEndpoint, {
      params: {
        assignedPhoneNumber: payload.assignedPhoneNumber,
        doctorName: payload.doctorName,
        date: payload.date,
        time: payload.time,
      },
      headers,
      timeout: 8000,
    });
    return { success: true, availability: response.data };
  }
}

function getQueueCheckDate(args = {}) {
  return firstText(args.date, args.appointment_date);
}

function isSundayDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  const value = new Date(`${date}T12:00:00+05:30`);
  if (Number.isNaN(value.getTime())) return false;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(value) === 'Sun';
}

function applyQueueDateLimit(availability, date) {
  const data = availability?.data || availability || {};
  const booked = Number(data.booked || 0);
  const apiLimit = Number(data.limit || 80);
  const effectiveLimit = isSundayDate(date) ? 45 : apiLimit;
  const remaining = Math.max(0, effectiveLimit - booked);
  const followUpRemaining = Number(data.followUpQueueRemaining);
  const followUpFull = Number.isFinite(followUpRemaining) && followUpRemaining <= 0;

  return {
    ...data,
    full: data.full === true || remaining <= 0 || followUpFull,
    limit: effectiveLimit,
    remaining,
    sundayLimitApplied: effectiveLimit === 45,
  };
}

async function fetchQueueStatusAvailability({ args, callContext }) {
  const availabilityEndpoint = resolveEndpoint(
    callContext.availability_endpoint || deriveAvailabilityEndpoint(callContext.booking_endpoint),
    callContext
  );
  const date = getQueueCheckDate(args);

  if (!availabilityEndpoint || !date) {
    return { success: false, error: 'Queue availability endpoint or date is missing.' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (callContext.booking_auth_header) headers.Authorization = callContext.booking_auth_header;

  const response = await axios.get(availabilityEndpoint, {
    params: {
      assignedPhoneNumber: callContext.to_phone,
      doctorName: args.doctor_name,
      date,
      queueStatus: true,
      patient_type: 'follow_up',
    },
    headers,
    timeout: 3000,
  });

  return {
    success: true,
    availability: applyQueueDateLimit(response.data, date),
    date,
  };
}

function startBackgroundQueueCheck(args, callContext) {
  const date = getQueueCheckDate(args);
  if (!date) return null;
  if (callContext.checked_dates.has(date)) {
    return Promise.resolve(callContext.checked_dates.get(date).result);
  }
  if (callContext.in_flight_checks.has(date)) {
    return callContext.in_flight_checks.get(date).promise;
  }
  if (callContext.availability_call_count >= 2) return null;

  callContext.availability_call_count += 1;
  callContext.selected_appointment_date = date;
  const promise = fetchQueueStatusAvailability({ args, callContext })
    .catch((error) => ({
      success: false,
      error: error.response?.data?.error || error.message,
      date,
    }))
    .then((result) => {
      callContext.checked_dates.set(date, { result, checkedAt: Date.now() });
      callContext.in_flight_checks.delete(date);
      console.log(`[QUEUE_BACKGROUND] Completed for ${date}:`, result.success);
      return result;
    });

  callContext.in_flight_checks.set(date, {
    doctorName: firstText(args.doctor_name),
    promise,
    startedAt: Date.now(),
  });
  console.log(`[QUEUE_BACKGROUND] Started for ${date}`);
  return promise;
}

async function getStoredQueueCheck(args, callContext) {
  const date = getQueueCheckDate(args) || callContext.selected_appointment_date;
  if (!date) return null;

  const checked = callContext.checked_dates.get(date);
  if (checked) return checked.result;

  const inFlight = callContext.in_flight_checks.get(date);
  return inFlight ? inFlight.promise : null;
}

function getQueueRuntimeContext(callContext) {
  const date = callContext.selected_appointment_date;
  if (!date) return 'No queue availability check has started.';

  const checked = callContext.checked_dates.get(date);
  if (checked) {
    return `checkedDates[${date}] = ${JSON.stringify(checked.result)}`;
  }

  if (callContext.in_flight_checks.has(date)) {
    return `checkedDates[${date}] = pending in background`;
  }

  return `checkedDates[${date}] = unavailable`;
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

      const sundayBooking = isSundayDate(appointmentDate);
      const queueArgs = { ...args, date: appointmentDate };
      const storedQueueResult = await getStoredQueueCheck(queueArgs, callContext);
      const queueFlowActive = Boolean(storedQueueResult);
      if (patientType === 'follow_up' || (sundayBooking && queueFlowActive)) {
        const availabilityResult = storedQueueResult || await fetchMedicalAvailability({
          args,
          callContext,
          headers,
          appointmentDate,
          appointmentTime,
        });

        if (!availabilityResult.success) {
          return {
            success: false,
            error: availabilityResult.error,
            instruction: 'Could not check queue availability. Do NOT confirm booking. Ask caller to try again or contact reception.',
          };
        }

        const followUpQueue = extractFollowUpQueueAvailability(availabilityResult.availability, args.doctor_name);
        const sundayFull = queueFlowActive && sundayBooking &&
          Number(followUpQueue?.totalBooked || 0) >= 45;
        const followUpFull = patientType === 'follow_up' &&
          followUpQueue && (!followUpQueue.canBook || followUpQueue.remaining <= 0);
        if (sundayFull || followUpFull) {
          return {
            success: false,
            error: 'Queue is full for this date.',
            queueFull: true,
            followUpQueue,
            availability: availabilityResult.availability,
            instruction: 'Queue is full. Do NOT confirm booking. Tell the caller this date is full and offer the next day.',
          };
        }
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

      if (isQueueCapacityCheck({ name: 'check_doctor_availability', args }, '')) {
        const storedResult = await getStoredQueueCheck(args, callContext);
        if (storedResult) {
          console.log(`[QUEUE_BACKGROUND] Reused for ${getQueueCheckDate(args)}`);
          return { ...storedResult, reused: true };
        }

        return fetchQueueStatusAvailability({ args, callContext });
      }

      const payload = {
        doctorName: args.doctor_name,
        date: args.date,
        time: args.time || args.appointment_time || null,
        assignedPhoneNumber: callContext.to_phone,
        doctor_name: args.doctor_name,
        appointment_time: args.time || args.appointment_time || null,
        patient_type: args.patient_type || args.patientType || null,
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
    checked_dates: new Map(),
    in_flight_checks: new Map(),
    availability_call_count: 0,
    selected_appointment_date: null,
    preferred_language: null,
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

        // Keep filler speech in the language used by the assistant in the
        // ongoing conversation; the latest user reply may be short or mixed.
        const detectedLang = detectLanguage(userMessage);
        callContext.preferred_language = getConversationLanguage(
          transcript.slice(0, -1),
          userMessage,
          callContext.preferred_language
        );
        const userLang = callContext.preferred_language;
        console.log(`[LANG] Detected: ${detectedLang}; using: ${userLang}`);

        if (
          normalizePatientType(userMessage) === 'follow_up' &&
          callContext.selected_appointment_date
        ) {
          await getStoredQueueCheck(
            { date: callContext.selected_appointment_date },
            callContext
          );
        }

        const ist = getISTDateInfo();
        const queueRuntimeContext = getQueueRuntimeContext(callContext);
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
Runtime queue state: ${queueRuntimeContext}
Runtime availability API call count: ${callContext.availability_call_count}

⚠️ Reply per system prompt language. Time/date in user's language (e.g. Hindi: "सुबह दस बजे"), never raw English numbers.

⚠️ IMPORTANT: If "Booking completed this call: true" — DO NOT call book_appointment again. Just briefly reconfirm and end gracefully.

⚠️ When generating confirmation after booking, DO NOT include filler phrases like "बुक कर रही हूं" — system already speaks a filler before booking. Go directly to final confirmation.

⚠️ When generating the answer after check_doctor_availability, DO NOT include filler phrases like "चेक कर रही हूं" or "देख रही हूं". Queue availability checks are completely silent; go directly to the result.

⚠️ If book_appointment tool response contains queueNumber, ALWAYS tell the caller that exact appointment number as "aapka number [number] hai".

Do not speak the words "queue number" to the caller. For appointments, say "aapka number [number] hai".

Queue background flow (OPD queue doctors only):
- Immediately after resolving the requested date, call check_doctor_availability once with background_check=true, patient_type=follow_up, doctor_name, and the YYYY-MM-DD date.
- Do not produce text with that tool call. The runtime asks the patient name while the API runs.
- On later turns, read Runtime queue state above. Do not call availability again for a date already present in checkedDates.
- New patients ignore the stored result except that Sunday total capacity still applies. Follow-up patients must obey the stored result.
- Never set background_check for fixed-slot doctors or service businesses.

Tools available:
- book_appointment: book a new appointment or service visit (ONLY use after collecting date and name. For follow-up/old/review patients, check availability first and book only if followUpQueueRemaining is greater than 0. For OPD queue doctors, time is optional and queue number is assigned by the API. For fixed-slot doctors and Tankro, collect time; for Tankro include district/location and purpose/service details)
- check_doctor_availability: check available slots or OPD queue capacity for a doctor or service location on a date. For follow-up/old/review queue capacity, send patient_type as follow_up; queue availability checking is completely silent.
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

            const backgroundQueueCall = functionCalls.find(isBackgroundQueueCheck);
            if (backgroundQueueCall) {
              if (bookingCompleted) {
                const completedText = lastBookingQueueNumber
                  ? `Ji haan, aapka number ${lastBookingQueueNumber} hai.`
                  : 'Ji haan, aapka appointment book ho chuka hai.';
                streamTextToMillis(ws, streamId, completedText);
                return;
              }

              const backgroundPromise = startBackgroundQueueCheck(
                backgroundQueueCall.args || {},
                callContext
              );
              if (!backgroundPromise) {
                streamTextToMillis(
                  ws,
                  streamId,
                  'सही दिन का नंबर लगाने के लिए क्या मैं हॉस्पिटल से कॉल करवा दूं?'
                );
                return;
              }

              const patientNameKnown = Boolean(firstText(
                backgroundQueueCall.args?.patient_name,
                backgroundQueueCall.args?.patientName
              ));
              const nextQuestion = patientNameKnown
                ? (userLang === 'en'
                    ? 'Is the patient new or follow-up?'
                    : (userLang === 'mr'
                        ? 'Patient nava aahe ki follow-up?'
                        : 'मरीज़ पहली बार आ रहे हैं या पुराने हैं?'))
                : (userLang === 'en'
                    ? 'What is the patient name?'
                    : (userLang === 'mr' ? 'Patientche naav kay aahe?' : 'आपका नाम क्या है?'));
              streamTextToMillis(ws, streamId, nextQuestion);
              console.log('[QUEUE_BACKGROUND] Next booking question sent without waiting');
              return;
            }

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
              (call) => call.name === 'check_doctor_availability' && !isQueueCapacityCheck(call, userMessage)
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
