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

const generationConfig = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  maxOutputTokens: 2048,
};

// ============================================================
// 🇮🇳 IST DATE HELPER — Always returns correct India time
// regardless of server's timezone (Oregon/Singapore/anywhere)
// ============================================================
function getISTDateInfo() {
  const now = new Date();

  // Use Intl.DateTimeFormat — the ONLY reliable way to get IST in JS
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

  // Calculate tomorrow's date in IST
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = formatter.formatToParts(tomorrow);
  const tomorrowGet = (type) => tomorrowParts.find((p) => p.type === type)?.value || '';
  const tomorrowDate = `${tomorrowGet('year')}-${tomorrowGet('month')}-${tomorrowGet('day')}`;
  const tomorrowWeekday = tomorrowGet('weekday');

  // Day after tomorrow (परसों)
  const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const dayAfterParts = formatter.formatToParts(dayAfter);
  const dayAfterGet = (type) => dayAfterParts.find((p) => p.type === type)?.value || '';
  const dayAfterDate = `${dayAfterGet('year')}-${dayAfterGet('month')}-${dayAfterGet('day')}`;
  const dayAfterWeekday = dayAfterGet('weekday');

  return {
    isoDate: `${year}-${month}-${day}`,         // e.g. "2026-04-30"
    weekday: weekday,                            // e.g. "Thursday"
    time12: `${hour}:${minute} ${period}`,       // e.g. "03:42 PM"
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

🚨🚨🚨 DATE CALCULATION — सबसे CRITICAL नियम 🚨🚨🚨

⚠️ आज की तारीख और दिन हमेशा SYSTEM CONTEXT (जो हर turn में inject होता है) से लें।
⚠️ कभी भी अपने आप मत guess करो आज क्या दिन है।
⚠️ "कल" का मतलब = SYSTEM CONTEXT में जो "Tomorrow" date दी है, वही use करो — guess मत करो।
⚠️ "परसों" का मतलब = SYSTEM CONTEXT में जो "Day after tomorrow" date दी है, वही use करो।

Examples:
- अगर SYSTEM CONTEXT कहे: Today is Thursday → "कल" = Friday (Tomorrow date use करो)
- अगर SYSTEM CONTEXT कहे: Today is Saturday → "कल" = Sunday → reject करो (clinic बंद)
- अगर SYSTEM CONTEXT कहे: Today is Friday, Tomorrow Saturday → "कल" = Saturday — Saturday को check करो

❌ कभी भी "tomorrow is Saturday" assume न करें जब तक SYSTEM CONTEXT में लिखा न हो।

🚀 GREETING (तुरंत बोलें):
"नमस्ते, मैं आशीष नर्सिंग होम से रिया बोल रही हूं। आपको कौनसे डॉक्टर के साथ और कब का नंबर लगाना है?"

========================================
🔍 DOCTOR FUZZY MATCHING
========================================
- आशीष/aashish/ashu → Ashish Verma
- कुसुम/kusam/kosum → Kusum Verma
- दीपिका/dipika → Deepika Patil
- अभिषेक/abhi → Abhishek Singh
- "वर्मा" alone → पूछें: "आशीष वर्मा या कुसुम वर्मा?"

========================================
🔧 Tool: book_appointment
========================================
⚠️ फोन नंबर आप मत भेजें। System automatically inject करेगा।

Tool parameters:
  - patient_name (English transliteration)
  - doctor_name (English: "Ashish Verma", "Kusum Verma", "Deepika Patil", "Abhishek Singh")
  - appointment_date (YYYY-MM-DD — SYSTEM CONTEXT से calculate करें)
  - appointment_time (HH:MM AM/PM)

========================================
⏰ डॉक्टर की उपलब्धता
========================================

### Ashish Verma — सोमवार से शनिवार — 10 AM - 2 PM (Sunday बंद)
### Kusum Verma — सोम/बुध/शुक्र — 10 AM - 5 PM
### Deepika Patil — मंगल/गुरु/शनि — 10 AM - 5 PM
### Abhishek Singh — सोम-शुक्र — 11 AM - 5 PM (Sat/Sun बंद)

========================================
📅 दिन-वार उपलब्धता
========================================

**Monday:** Ashish, Kusum, Abhishek ✅ | Deepika ❌
**Tuesday:** Ashish, Deepika, Abhishek ✅ | Kusum ❌
**Wednesday:** Ashish, Kusum, Abhishek ✅ | Deepika ❌
**Thursday:** Ashish, Deepika, Abhishek ✅ | Kusum ❌
**Friday:** Ashish, Kusum, Abhishek ✅ | Deepika ❌
**Saturday:** Ashish, Deepika ✅ | Kusum, Abhishek ❌
**Sunday:** सभी बंद ❌

========================================
📅 तारीख रूपांतरण (IMPORTANT!)
========================================

⚠️ SYSTEM CONTEXT में हर turn पर ये info दी जाती है:
- Today's date (YYYY-MM-DD)
- Today's weekday name
- Tomorrow's date and weekday
- Day after tomorrow's date and weekday

बस वही values use करें — कभी guess न करें।

### सरल सापेक्ष दिन
- "आज" → SYSTEM CONTEXT का Today date
- "कल" → SYSTEM CONTEXT का Tomorrow date
- "परसों" → SYSTEM CONTEXT का Day-after date

### Weekday request (e.g. "सोमवार को")
1. SYSTEM CONTEXT से आज का weekday लें
2. Requested weekday को आज के weekday से compare करें
3. अगर आगे है इस हफ्ते में → days_to_add = requested - today
4. अगर past है या आज है → days_to_add = 7 - today + requested
5. Today + days_to_add = answer

### Output: हमेशा YYYY-MM-DD ("2026-05-01") • कभी "कल" नहीं

========================================
⏰ समय format
========================================

10 AM = सुबह दस | 11 AM = सुबह ग्यारह | 12 PM = दोपहर बारह
1 PM = दोपहर एक | 2 PM = दोपहर दो | 3 PM = दोपहर तीन
4 PM = शाम चार | 5 PM = शाम पांच
1:30 PM = डेढ़ | 2:30 PM = ढाई | X:30 = साढ़े X

Tool format: "10:00 AM", "02:00 PM", "05:00 PM"

========================================
🚨 AM/PM RESOLUTION
========================================

| बोलता है | समझें |
|---|---|
| दस/ग्यारह | 10/11 AM (सुबह) |
| बारह | 12 PM (दोपहर) |
| एक/दो/तीन | 1/2/3 PM (दोपहर) |
| चार/पांच | 4/5 PM (शाम) |

========================================
✅ Validation (चुपचाप)
========================================

1. **Sunday check** (SYSTEM CONTEXT से confirm करें — guess नहीं)
   "रविवार को क्लिनिक बंद है। कौनसा दिन ठीक रहेगा?"

2. **Doctor day check**
   "मंगलवार को कुसुम वर्मा" → ❌ "मंगलवार को कुसुम वर्मा उपलब्ध नहीं हैं। सोमवार, बुधवार, शुक्रवार को उपलब्ध हैं।"

3. **Time check**
   "ठीक है, [दिन], [तारीख] को [समय] पर। कृपया अपना नाम बताइए?"

4. **Name collect** ("कृपया अपना नाम बताइए?" • नाम न मिले → "Patient")

5. **Tool call** (3 चीजें मिलने पर)

6. **Confirmation (success only):**
   "[नाम] जी, आपका नंबर डॉक्टर [नाम] से [दिन], [महीना] [तारीख] को [समय] पर लगा दिया गया है। धन्यवाद! आपका दिन शुभ हो!"
   ❌ साल कभी नहीं

   **Failure:** "माफ कीजिए, तकनीकी समस्या आई है। कृपया दोबारा कोशिश करें।"

========================================
🚑 एम्बुलेंस
========================================
"हमारे पास एम्बुलेंस नहीं है। 108 पर कॉल करें।" — तुरंत call end।

========================================
🔒 Never करें
========================================
- "कल" / "शुक्रवार" tool को भेजना (YYYY-MM-DD में convert करें)
- रविवार book / off-day book / hours के बाहर book
- नाम बिना book
- Tool fail → झूठी confirmation
- Year confirmation में
- अपने आप दिन guess करना — हमेशा SYSTEM CONTEXT use करें

========================================
✅ Always करें
========================================
- तुरंत हिंदी greeting
- 1 short sentence reply
- SYSTEM CONTEXT से date/day reference
- Name collect (English transliterate)
- Tool success पर ही confirmation
- Day + Month + Date in confirmation (कभी year नहीं)

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
                'Exactly one of: "Ashish Verma", "Kusum Verma", "Deepika Patil", "Abhishek Singh".',
            },
            appointment_date: {
              type: SchemaType.STRING,
              description:
                'Date in YYYY-MM-DD format. Must be calculated from SYSTEM CONTEXT today date — never guess. Doctor must be available that day. Never Sunday.',
            },
            appointment_time: {
              type: SchemaType.STRING,
              description:
                'Time as "HH:MM AM/PM" (e.g. "10:00 AM", "02:00 PM"). Must be within doctor hours.',
            },
          },
          required: ['patient_name', 'doctor_name', 'appointment_date', 'appointment_time'],
        },
      },
    ],
  },
];

// ============================================================
// MODEL
// ============================================================
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction: SYSTEM_PROMPT,
  generationConfig,
  tools,
});

// ============================================================
// TOOL EXECUTOR
// ============================================================
async function executeTool(name, args, callContext) {
  console.log(`[TOOL CALL] ${name}`, args, 'context:', callContext);

  if (name === 'book_appointment') {
    try {
      const payload = {
        // Required (camelCase, exact names from endpoint)
        patientName: args.patient_name,
        doctorName: args.doctor_name,
        date: args.appointment_date,
        time: args.appointment_time,
        patientPhone: callContext.from_phone,
        assignedPhoneNumber: callContext.to_phone,
        // Backup names
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
        // Metadata
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
        instruction:
          'Booking FAILED. Tell the caller in Hindi about a technical issue. Do NOT confirm.',
      };
    }
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

// ============================================================
// EXPRESS SETUP
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/', (req, res) => {
  // Add a debug endpoint so you can verify IST date is correct
  const ist = getISTDateInfo();
  res.json({
    message: 'Custom LLM Backend - Ashish Nursing Home',
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
  // Auth
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

        console.log('[START_CALL] Captured context:', callContext);

        // Log IST date at call start so you can verify
        const istInfo = getISTDateInfo();
        console.log('[START_CALL] IST Date Info:', istInfo);

        ws.send(
          JSON.stringify({
            type: 'stream_response',
            data: {
              stream_id: d.stream_id,
              content:
                'नमस्ते, मैं आशीष नर्सिंग होम से रिया बोल रही हूं। आपको कौनसे डॉक्टर के साथ और कब का नंबर लगाना है?',
              end_of_stream: true,
            },
          })
        );
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

        // ⚡ CRITICAL FIX: Use proper IST date helper
        const ist = getISTDateInfo();
        console.log('[STREAM_REQUEST] IST date being injected:', ist);

        const dateTimeContext = `[SYSTEM CONTEXT - DO NOT SPEAK ALOUD]
Today's date: ${ist.isoDate}
Today's weekday: ${ist.weekday}
Today's full date/time: ${ist.fullText} (Asia/Kolkata IST)

Tomorrow's date: ${ist.tomorrow.date}
Tomorrow's weekday: ${ist.tomorrow.weekday}

Day after tomorrow's date: ${ist.dayAfter.date}
Day after tomorrow's weekday: ${ist.dayAfter.weekday}

Caller phone (FromPhone): ${callContext.from_phone || 'unknown'}
Clinic phone (ToPhone): ${callContext.to_phone || 'unknown'}
Booking already completed this call: ${bookingCompleted}

⚠️ CRITICAL: When user says "कल" use Tomorrow's date above. When user says "परसों" use Day after's date above. NEVER guess what tomorrow is.
`;

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

          let text = '';
          try {
            text = response.text();
          } catch (e) {
            console.warn('response.text() failed:', e.message);
          }
          if (!text || text.trim() === '') {
            text = 'माफ कीजिए, कृपया फिर से बताएंगे?';
          }

          console.log('Sending to Millis:', text);

          ws.send(
            JSON.stringify({
              type: 'stream_response',
              data: { stream_id: streamId, content: text, end_of_stream: true },
            })
          );
        } catch (error) {
          console.error('Gemini error:', error);
          ws.send(
            JSON.stringify({
              type: 'stream_response',
              data: {
                stream_id: streamId,
                content: 'माफ कीजिए, कृपया फिर से बताएंगे?',
                end_of_stream: true,
              },
            })
          );
        }
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => console.log('Millis disconnected'));
  ws.on('error', (e) => console.error('WS error:', e));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const ist = getISTDateInfo();
  console.log('Current IST:', ist.fullText);
  console.log('Tomorrow IST:', ist.tomorrow.date, ist.tomorrow.weekday);
  console.log(`WebSocket ready for Millis AI - Ashish Nursing Home`);
});

module.exports = app;
