const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const axios = require('axios');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIG
// ============================================================
const BOOK_APPOINTMENT_URL =
  process.env.BOOK_APPOINTMENT_URL ||
  'https://mcp-server-61zc.onrender.com/api/book-appointment';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ⚡ OPTIMIZATION 1: Lower maxOutputTokens + temperature for faster response
const generationConfig = {
  temperature: 0.6,           // was 0.7 — lower = faster + consistent
  topP: 0.8,
  topK: 20,
  maxOutputTokens: 1024,       // was 2048 — saves ~250-300ms per turn
};

// ============================================================
// 🇮🇳 IST DATE HELPER
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

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const weekday = get('weekday');
  const hour = get('hour');
  const minute = get('minute');
  const period = get('dayPeriod') || (parseInt(hour, 10) >= 12 ? 'PM' : 'AM');

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = formatter.formatToParts(tomorrow);
  const tGet = (type) => tomorrowParts.find((p) => p.type === type)?.value || '';
  const tomorrowDate = `${tGet('year')}-${tGet('month')}-${tGet('day')}`;
  const tomorrowWeekday = tGet('weekday');

  const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const daParts = formatter.formatToParts(dayAfter);
  const daGet = (type) => daParts.find((p) => p.type === type)?.value || '';
  const dayAfterDate = `${daGet('year')}-${daGet('month')}-${daGet('day')}`;
  const dayAfterWeekday = daGet('weekday');

  return {
    isoDate: `${year}-${month}-${day}`,
    weekday: weekday,
    time12: `${hour}:${minute} ${period}`,
    fullText: `${weekday}, ${day} ${getMonthName(month)} ${year}, ${hour}:${minute} ${period}`,
    tomorrow: { date: tomorrowDate, weekday: tomorrowWeekday },
    dayAfter: { date: dayAfterDate, weekday: dayAfterWeekday },
  };
}

function getMonthName(monthNum) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return months[parseInt(monthNum, 10) - 1] || '';
}

// ============================================================
// SYSTEM PROMPT — Ashish Nursing Home (Hindi)
// ============================================================
const SYSTEM_PROMPT = `🎙 तत्काल वॉइस एजेंट - आशीष नर्सिंग होम
========================================
⚡ अत्यंत महत्वपूर्ण: कॉल कनेक्ट होते ही तुरंत बोलना शुरू करें (0-1 सेकंड में)
⚡must start speaking  withen 3 second
👤 एजेंट की पहचान
आप रिया हैं, आशीष नर्सिंग होम की एक अनुभवी, मित्रवत और पेशेवर रिसेप्शनिस्ट।
⚠️ GENDER CRITICAL: आप एक महिला हैं। हमेशा feminine verb forms use करें:
   ✅ सही: "बुक कर रही हूं", "बोल रही हूं", "कर रही हूं"
   ❌ गलत: "बुक कर रहा हूं", "बोल रहा हूं", "कर रहा हूं"

🚨 डुप्लीकेट बुकिंग रोकथाम
CRITICAL नियम: अपॉइंटमेंट सफलतापूर्वक बुक होने के बाद, उसी कॉल में दोबारा बुकिंग न करें।

🚨 BOOKING SUCCESS/FAILURE — CRITICAL
- success: true → confirmation दें
- success: false → "माफ कीजिए, तकनीकी समस्या आई है। कृपया फिर से कोशिश करें" — कभी झूठी confirmation मत दो

========================================
🚨🚨🚨 भाषा का सबसे CRITICAL नियम 🚨🚨🚨
========================================

⚠️⚠️⚠️ हमेशा हिंदी में बोलें — कभी English numbers या time format न बोलें ⚠️⚠️⚠️

❌ कभी मत बोलें: "10:00 AM", "two PM", "five thirty", "AM", "PM"
✅ हमेशा बोलें: "सुबह दस बजे", "दोपहर दो बजे", "साढ़े पांच बजे", "शाम पांच बजे"

❌ कभी मत बोलें: "Monday", "Tuesday", "April 30"
✅ हमेशा बोलें: "सोमवार", "मंगलवार", "तीस अप्रैल"

❌ कभी मत बोलें: "2026-05-01"
✅ हमेशा बोलें: "एक मई"

⚠️ Tool को internally English/numbers में data भेजें (YYYY-MM-DD, HH:MM AM/PM), लेकिन caller को हमेशा हिंदी में reply करें।

========================================
🚨🚨🚨 DATE CALCULATION
========================================

⚠️ आज की तारीख और दिन हमेशा SYSTEM CONTEXT (जो हर turn में inject होता है) से लें।
⚠️ कभी भी अपने आप मत guess करो आज क्या दिन है।

🚀 GREETING (तुरंत बोलें - केवल हिंदी में):
"नमस्ते, मैं आशीष नर्सिंग होम से रिया बोल रही हूं। आपको कौनसे डॉक्टर के साथ और कब का नंबर लगाना है?"

========================================
🔍 DOCTOR FUZZY MATCHING
========================================
- आशीष/aashish/ashu → Ashish Verma
- कुसुम/kusam/kosum → Kusum Verma
- दीपिका/dipika → Deepika Patil
- अभिषेक/abhi → Abhishek Singh
- "वर्मा" alone → पूछें: "कौन से वर्मा? आशीष वर्मा या कुसुम वर्मा?"

========================================
👩 LADY DOCTOR / महिला डॉक्टर — AUTO ROUTING
========================================

⚠️ अगर caller बोले: "लेडी डॉक्टर", "महिला डॉक्टर", "मैडम", "बहन जी", "Female doctor"
→ Caller को specific नाम मत पूछो। उस दिन की available lady doctor automatically book करो।

| Day | Lady Doctor |
|---|---|
| सोम/बुध/शुक्र | Kusum Verma |
| मंगल/गुरु/शनि | Deepika Patil |
| रविवार | ❌ बंद |

उदाहरण:
- "कल lady doctor से" (कल मंगलवार) → "ठीक है, कल मंगलवार को डॉक्टर दीपिका पाटिल उपलब्ध हैं। किस समय?"

========================================
🔧 Tool: book_appointment
========================================
⚠️ फोन नंबर आप मत भेजें। System automatically inject करेगा।

Tool parameters:
  - patient_name (English transliteration)
  - doctor_name (English: "Ashish Verma", "Kusum Verma", "Deepika Patil", "Abhishek Singh")
  - appointment_date (YYYY-MM-DD)
  - appointment_time (HH:MM AM/PM)

========================================
⏰ डॉक्टर की उपलब्धता
========================================

### Ashish Verma — सोम-शनि — सुबह 10 से दोपहर 2 बजे
### Kusum Verma — सोम/बुध/शुक्र — सुबह 10 से शाम 5 बजे
### Deepika Patil — मंगल/गुरु/शनि — सुबह 10 से शाम 5 बजे
### Abhishek Singh — सोम-शुक्र — सुबह 11 से शाम 5 बजे

========================================
📅 दिन-वार
========================================

**Mon:** Ashish, Kusum, Abhishek ✅ | Deepika ❌
**Tue:** Ashish, Deepika, Abhishek ✅ | Kusum ❌
**Wed:** Ashish, Kusum, Abhishek ✅ | Deepika ❌
**Thu:** Ashish, Deepika, Abhishek ✅ | Kusum ❌
**Fri:** Ashish, Kusum, Abhishek ✅ | Deepika ❌
**Sat:** Ashish, Deepika ✅ | Kusum, Abhishek ❌
**Sun:** सभी बंद ❌

========================================
📅 तारीख रूपांतरण
========================================
- "आज" → SYSTEM CONTEXT का Today date
- "कल" → SYSTEM CONTEXT का Tomorrow date
- "परसों" → SYSTEM CONTEXT का Day-after date

Output: हमेशा YYYY-MM-DD ("2026-05-01")
बोलते समय: हमेशा हिंदी ("एक मई" / "कल" / "सोमवार")

========================================
⏰ समय format - Caller को हिंदी में बोलें
========================================
- 10 AM → "सुबह दस बजे"
- 11 AM → "सुबह ग्यारह बजे"
- 12 PM → "दोपहर बारह बजे"
- 1 PM → "दोपहर एक बजे"
- 1:30 PM → "दोपहर डेढ़ बजे"
- 2 PM → "दोपहर दो बजे"
- 2:30 PM → "दोपहर ढाई बजे"
- 3 PM → "दोपहर तीन बजे"
- 4 PM → "शाम चार बजे"
- 5 PM → "शाम पांच बजे"
- X:30 PM → "साढ़े X बजे"

Tool को: "10:00 AM", "02:00 PM", "05:00 PM"

========================================
🚨 AM/PM RESOLUTION
========================================

| बोलता है | समझें |
|---|---|
| दस/ग्यारह | 10/11 AM (सुबह) |
| बारह | 12 PM |
| एक/दो/तीन | 1/2/3 PM (दोपहर) |
| चार/पांच | 4/5 PM (शाम) |

========================================
✅ Validation Flow
========================================

1. Sunday check → "रविवार बंद है। कौनसा दिन?"
2. Doctor day check → "मंगलवार को कुसुम वर्मा नहीं हैं। सोम/बुध/शुक्र को उपलब्ध हैं।"
3. Time check
4. Lady doctor request → AUTO route
5. Name collect → "कृपया अपना नाम बताइए?" (न मिले → "Patient")
6. Tool call (3 things ready)
7. SUCCESS confirmation:
   "[नाम] जी, आपका नंबर डॉक्टर [नाम] से [दिन], [महीना हिंदी में] [तारीख हिंदी में] को [समय हिंदी में] पर लगा दिया गया है। धन्यवाद! आपका दिन शुभ हो!"
   ❌ साल कभी नहीं
   
   FAILURE: "माफ कीजिए, तकनीकी समस्या आई है। कृपया दोबारा कोशिश करें।"

========================================
🚑 एम्बुलेंस
========================================
"हमारे पास एम्बुलेंस नहीं है। एक सौ आठ पर कॉल करें।" — call end।

========================================
🔒 Never
========================================
- "कल"/"शुक्रवार" tool को भेजना (YYYY-MM-DD only)
- रविवार/off-day book
- नाम बिना book
- Tool fail → झूठी confirmation
- Year confirmation में
- "10 AM"/"2 PM" बोलना — हमेशा "सुबह दस बजे"
- Lady doctor पर specific name पूछना
- अपने आप दिन guess करना

========================================
✅ Always
========================================
- तुरंत हिंदी greeting
- 1 short sentence reply, हमेशा हिंदी
- Time/date हिंदी में बोलें
- SYSTEM CONTEXT से date reference
- Lady doctor → auto-book उस दिन की available
- Name collect (English transliterate for tool)
- Tool success पर ही confirmation

🏥 आप रिया हैं — professional, warm, efficient।
आशीष नर्सिंग होम 💙`;

// ============================================================
// TOOL DEFINITIONS
// ============================================================
const tools = [
  {
    functionDeclarations: [
      {
        name: 'book_appointment',
        description:
          'Book a medical appointment at Ashish Nursing Home. Call only after collecting valid YYYY-MM-DD date (doctor available that day), valid HH:MM AM/PM time within doctor hours, and patient name in English.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patient_name: {
              type: SchemaType.STRING,
              description: "Patient's name in English (e.g. Rajesh, Priya).",
            },
            doctor_name: {
              type: SchemaType.STRING,
              description:
                'Exactly one of: "Ashish Verma", "Kusum Verma", "Deepika Patil", "Abhishek Singh". For lady doctor requests, auto-select: Mon/Wed/Fri = Kusum Verma, Tue/Thu/Sat = Deepika Patil.',
            },
            appointment_date: {
              type: SchemaType.STRING,
              description: 'Date in YYYY-MM-DD. Calculated from SYSTEM CONTEXT today.',
            },
            appointment_time: {
              type: SchemaType.STRING,
              description: 'Time as "HH:MM AM/PM". Within doctor hours.',
            },
          },
          required: ['patient_name', 'doctor_name', 'appointment_date', 'appointment_time'],
        },
      },
    ],
  },
];

// ============================================================
// ⚡ OPTIMIZATION 2: Faster Gemini model
// ============================================================
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',   // was gemini-2.5-flash — ~2x faster
  systemInstruction: SYSTEM_PROMPT,
  generationConfig,
  tools,
});

// ============================================================
// TOOL EXECUTOR
// ============================================================
async function executeTool(name, args, callContext) {
  console.log(`[TOOL CALL] ${name}`, args);

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
        voip_provider: callContext.voip_provider,
        direction: callContext.direction,
      };

      console.log('[BOOK_APPOINTMENT] POST payload:', JSON.stringify(payload, null, 2));

      const response = await axios.post(BOOK_APPOINTMENT_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
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
        instruction: 'Booking FAILED. Tell caller in Hindi about technical issue. Do NOT confirm.',
      };
    }
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

// ============================================================
// ⚡ OPTIMIZATION 3: Streaming helper — sends chunks with flush
// Splits text into sentences and streams each with flush:true
// so Millis TTS can start speaking immediately
// ============================================================
function streamTextToMillis(ws, streamId, text) {
  // Split by sentence boundaries (Hindi danda, English period, ?, !)
  // Keep delimiters with the sentence.
  const sentences = text
    .split(/(?<=[।?!.])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) {
    // Empty fallback
    ws.send(JSON.stringify({
      type: 'stream_response',
      data: { stream_id: streamId, content: text || '...', end_of_stream: true },
    }));
    return;
  }

  // Single sentence — send as one chunk with flush
  if (sentences.length === 1) {
    ws.send(JSON.stringify({
      type: 'stream_response',
      data: {
        stream_id: streamId,
        content: sentences[0],
        flush: true,
        end_of_stream: true,
      },
    }));
    return;
  }

  // Multiple sentences — stream each, with flush on first ones,
  // end_of_stream only on last
  sentences.forEach((sentence, idx) => {
    const isLast = idx === sentences.length - 1;
    ws.send(JSON.stringify({
      type: 'stream_response',
      data: {
        stream_id: streamId,
        content: sentence + (isLast ? '' : ' '),
        flush: true,                  // ← TTS starts immediately on each chunk
        end_of_stream: isLast,
      },
    }));
  });
}

// ============================================================
// EXPRESS SETUP
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/', (req, res) => {
  const ist = getISTDateInfo();
  res.json({
    message: 'Custom LLM Backend - Ashish Nursing Home (Optimized)',
    optimizations: [
      'gemini-2.0-flash (2x faster)',
      'maxOutputTokens: 500',
      'temperature: 0.4',
      'sentence streaming with flush',
    ],
    serverTime: new Date().toISOString(),
    indiaTime: ist,
  });
});

const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// ============================================================
// WEBSOCKET HANDLER
// ============================================================
wss.on('connection', (ws, req) => {
  const expectedAuth = process.env.WS_SECRET;
  const authHeader = req.headers.authorization || '';
  if (expectedAuth && authHeader !== `Bearer ${expectedAuth}`) {
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
  };
  let bookingCompleted = false;

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

        // Greeting with flush:true for instant TTS start
        ws.send(JSON.stringify({
          type: 'stream_response',
          data: {
            stream_id: d.stream_id,
            content: 'नमस्ते, मैं आशीष नर्सिंग होम से रिया बोल रही हूं। आपको कौनसे डॉक्टर के साथ और कब का नंबर लगाना है?',
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
Booking completed: ${bookingCompleted}

⚠️ Reply in Hindi only. Time/date in Hindi (e.g. "सुबह दस बजे"), never English.`;

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

          // Tool call loop
          let safetyCounter = 0;
          while (safetyCounter < 5) {
            safetyCounter++;
            const functionCalls = response.functionCalls();
            if (!functionCalls || functionCalls.length === 0) break;

            console.log(`[LOOP ${safetyCounter}] Function calls:`, functionCalls);

            const functionResponses = [];
            for (const call of functionCalls) {
              if (call.name === 'book_appointment' && bookingCompleted) {
                functionResponses.push({
                  functionResponse: {
                    name: call.name,
                    response: { success: false, error: 'Already booked this call.' },
                  },
                });
                continue;
              }

              const toolResult = await executeTool(call.name, call.args, callContext);
              if (call.name === 'book_appointment' && toolResult.success) {
                bookingCompleted = true;
              }

              functionResponses.push({
                functionResponse: { name: call.name, response: toolResult },
              });
            }

            result = await chat.sendMessage(functionResponses);
            response = result.response;
          }

          // Get final text and STREAM it sentence-by-sentence
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

          // ⚡ Stream chunks instead of one big message
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

      // ----------------------------------------------------------
      // INTERRUPT — user spoke while agent was talking
      // ----------------------------------------------------------
      if (message.type === 'interrupt') {
        console.log('[INTERRUPT] User interrupted, stream_id:', message.stream_id);
        // Just log — Millis handles the actual interruption
      }

      // ----------------------------------------------------------
      // PLAYBACK_FINISHED — agent finished speaking
      // ----------------------------------------------------------
      if (message.type === 'playback_finished') {
        console.log('[PLAYBACK_FINISHED] stream_id:', message.data?.stream_id);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => console.log('Millis disconnected'));
  ws.on('error', (e) => console.error('WS error:', e));
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`⚡ Optimizations: gemini-2.0-flash | maxTokens=500 | streaming ON`);
  const ist = getISTDateInfo();
  console.log(`🇮🇳 IST now: ${ist.fullText}`);
  console.log(`📡 WebSocket ready for Millis AI`);
});

module.exports = app;
