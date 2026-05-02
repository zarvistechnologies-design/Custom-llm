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
    time12: `${get('hour')}:${get('minute')} ${get('dayPeriod') || 'PM'}`,
    fullText: `${get('weekday')}, ${get('day')}/${get('month')}/${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod') || 'PM'}`,
    tomorrow: { date: `${tGet('year')}-${tGet('month')}-${tGet('day')}`, weekday: tGet('weekday') },
    dayAfter: { date: `${daGet('year')}-${daGet('month')}-${daGet('day')}`, weekday: daGet('weekday') },
  };
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

  // ============================================================
  // TOOL 1: BOOK APPOINTMENT
  // ============================================================
  if (name === 'book_appointment') {
    try {
      const payload = {
        patientName: args.patient_name,
        doctorName: args.doctor_name,
        date: args.appointment_date,
        time: args.appointment_time,
        patientPhone: callContext.from_phone,
        assignedPhoneNumber: callContext.to_phone,
        patient_name: args.patient_name,
        doctor_name: args.doctor_name,
        appointment_date: args.appointment_date,
        appointment_time: args.appointment_time,
        patient_phone: callContext.from_phone,
        clinic_phone: callContext.to_phone,
        FromPhone: callContext.from_phone,
        ToPhone: callContext.to_phone,
        from_phone: callContext.from_phone,
        to_phone: callContext.to_phone,
        session_id: callContext.session_id,
        call_id: callContext.call_id,
        clinic_name: callContext.clinic_name,
      };

      console.log('[BOOK_APPOINTMENT] Endpoint:', callContext.booking_endpoint);
      console.log('[BOOK_APPOINTMENT] Payload:', JSON.stringify(payload, null, 2));

      const response = await axios.post(callContext.booking_endpoint, payload, {
        headers,
        timeout: 8000,
      });

      console.log('[BOOK_APPOINTMENT] ✅ Response:', response.data);
      return { success: true, confirmation: response.data };
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

  // ============================================================
  // TOOL 2: CHECK DOCTOR AVAILABILITY
  // ============================================================
  if (name === 'check_doctor_availability') {
    try {
      if (!callContext.availability_endpoint) {
        return {
          success: false,
          error: 'Availability endpoint not configured for this clinic.',
        };
      }

      const payload = {
        doctorName: args.doctor_name,
        date: args.date,
        assignedPhoneNumber: callContext.to_phone,
        doctor_name: args.doctor_name,
        clinic_phone: callContext.to_phone,
        ToPhone: callContext.to_phone,
        session_id: callContext.session_id,
        clinic_name: callContext.clinic_name,
      };

      console.log('[CHECK_AVAILABILITY] Endpoint:', callContext.availability_endpoint);
      console.log('[CHECK_AVAILABILITY] Payload:', JSON.stringify(payload, null, 2));

      const response = await axios.post(callContext.availability_endpoint, payload, {
        headers,
        timeout: 8000,
      });

      console.log('[CHECK_AVAILABILITY] ✅ Response:', response.data);
      return { success: true, availability: response.data };
    } catch (err) {
      console.error('[CHECK_AVAILABILITY] ❌ Error:', err.message);
      if (err.response) {
        console.error('[CHECK_AVAILABILITY] Status:', err.response.status);
        console.error('[CHECK_AVAILABILITY] Endpoint said:', JSON.stringify(err.response.data, null, 2));
      }
      return {
        success: false,
        error: err.message,
        endpoint_response: err.response?.data,
        instruction:
          'Could not fetch availability. Tell caller about technical issue or fallback to general hours.',
      };
    }
  }

  // ============================================================
  // TOOL 3: GET DOCTORS LIST
  // ============================================================
  if (name === 'get_doctors') {
    try {
      if (!callContext.doctors_endpoint) {
        return {
          success: false,
          error: 'Doctors endpoint not configured for this clinic.',
        };
      }

      const payload = {
        speciality: args.speciality || null,
        assignedPhoneNumber: callContext.to_phone,
        clinic_phone: callContext.to_phone,
        ToPhone: callContext.to_phone,
        session_id: callContext.session_id,
        clinic_name: callContext.clinic_name,
      };

      console.log('[GET_DOCTORS] Endpoint:', callContext.doctors_endpoint);
      console.log('[GET_DOCTORS] Payload:', JSON.stringify(payload, null, 2));

      const response = await axios.post(callContext.doctors_endpoint, payload, {
        headers,
        timeout: 8000,
      });

      console.log('[GET_DOCTORS] ✅ Response:', response.data);
      return { success: true, doctors: response.data };
    } catch (err) {
      console.error('[GET_DOCTORS] ❌ Error:', err.message);
      if (err.response) {
        console.error('[GET_DOCTORS] Status:', err.response.status);
        console.error('[GET_DOCTORS] Endpoint said:', JSON.stringify(err.response.data, null, 2));
      }
      return {
        success: false,
        error: err.message,
        endpoint_response: err.response?.data,
        instruction:
          'Could not fetch doctors list. Tell caller about technical issue or use info from system prompt.',
      };
    }
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

// ============================================================
// STREAMING HELPER
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

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received:', message.type);

      // ----------------------------------------------------------
      // START_CALL — capture phone, LOAD CLINIC FROM DB
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
        console.log(`[START_CALL] Endpoints: book=${!!callContext.booking_endpoint}, avail=${!!callContext.availability_endpoint}, doctors=${!!callContext.doctors_endpoint}`);

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

        const ist = getISTDateInfo();
        const dateTimeContext = `[SYSTEM CONTEXT - DO NOT SPEAK ALOUD]
Today's date: ${ist.isoDate}
Today's weekday: ${ist.weekday}
Tomorrow's date: ${ist.tomorrow.date}
Tomorrow's weekday: ${ist.tomorrow.weekday}
Day after tomorrow's date: ${ist.dayAfter.date}
Day after tomorrow's weekday: ${ist.dayAfter.weekday}

Caller phone (FromPhone): ${callContext.from_phone || 'unknown'}
Clinic phone (ToPhone): ${callContext.to_phone || 'unknown'}
Clinic: ${clinicConfig.name}
Booking completed this call: ${bookingCompleted}

⚠️ Reply per system prompt language. Time/date in user's language (e.g. Hindi: "सुबह दस बजे"), never raw English numbers.

⚠️ IMPORTANT: If "Booking completed this call: true" — DO NOT call book_appointment again. Just briefly reconfirm in user's language and end gracefully.

Tools available:
- book_appointment: book a new appointment (ONLY use after collecting date, time, name, AND only if no booking yet)
- check_doctor_availability: check available slots for a doctor on a date
- get_doctors: get list of all doctors at this clinic`;

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
          // Tool call loop with smart duplicate booking handling
          // ============================================================
          let safetyCounter = 0;
          let shortCircuitTriggered = false;

          while (safetyCounter < 5) {
            safetyCounter++;
            const functionCalls = response.functionCalls();
            if (!functionCalls || functionCalls.length === 0) break;

            console.log(`[LOOP ${safetyCounter}] Function calls:`, functionCalls);

            // ============================================================
            // ⚡ SHORT-CIRCUIT: Duplicate booking attempt
            // Tool execute NHI hoga, seedha confirmation bhejo
            // ============================================================
            const hasDuplicateBooking = functionCalls.some(
              (call) => call.name === 'book_appointment' && bookingCompleted
            );

            if (hasDuplicateBooking) {
              console.log('[SKIP DUPLICATE] Booking already done — sending direct confirmation, no tool call');
              const text = 'जी हाँ, आपका अपॉइंटमेंट पहले से बुक हो चुका है। धन्यवाद! आपका दिन शुभ हो!';
              console.log('Sending to Millis (streamed):', text);
              streamTextToMillis(ws, streamId, text);
              shortCircuitTriggered = true;
              break;
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
                  console.log('[BOOKING] ✅ Marked as completed');
                } else {
                  // ⚠️ REAL technical error — let Gemini handle it (will say "तकनीकी समस्या")
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

          // If short-circuit already sent response, skip the rest
          if (shortCircuitTriggered) {
            return;
          }

          // Get final text and stream it
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
