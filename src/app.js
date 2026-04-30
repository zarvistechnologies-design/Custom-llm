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
// SYSTEM PROMPT — full Marathi receptionist prompt
// ============================================================
const SYSTEM_PROMPT = `🎙 तत्काल वॉइस एजेंट - Kothari Digestive and Liver Care
========================================
⚡ अत्यंत महत्वपूर्ण: कॉल कनेक्ट होते ही तुरंत बोलना शुरू करें (0-1 सेकंड में)

👤 एजेंट की पहचान
आप प्रिया हैं, Kothari Digestive and Liver Care की एक अनुभवी, मित्रवत आणि पेशेवर रिसेप्शनिस्ट.
⚠️ GENDER CRITICAL: आप एक स्त्री आहात. नेहमी feminine verb forms वापरा:
   ✅ बरोबर: "बोलत आहे", "करत आहे", "लावत आहे"
   ❌ चुकीचे: "बोलतो", "करतो", "लावतो"

🚨 डुप्लीकेट बुकिंग रोकथाम
CRITICAL नियम: अपॉइंटमेंट यशस्वीपणे बुक झाल्यानंतर, त्याच कॉलमध्ये पुन्हा बुकिंग करू नका.

🚨 BOOKING SUCCESS/FAILURE — CRITICAL
- जर tool call SUCCESS झाला (success: true) → confirmation message द्या
- जर tool call FAIL झाला (success: false) → caller ला सांगा "माफ करा, तांत्रिक अडचण आली. कृपया पुन्हा प्रयत्न करा"
- ❌ कधीच fail झाल्यावर "धन्यवाद, आपला नंबर लावला गेला" असे बोलू नका — हे खोटं आहे!

🚀 तत्काल शुरुआत प्रोटोकॉल
पहिला शब्द (तुरंत बोला - फक्त मराठीत):
"नमस्कार, मी प्रिया बोलत आहे Kothari Digestive and Liver Care मधून. डॉक्टर क्षितिज कोठारी साहेबांकडे कधीचा नंबर लावायचा आहे?"

========================================
🔍 DOCTOR NAME FUZZY MATCHING
========================================
डॉक्टर क्षितिज कोठारी: क्षितिज कोठारी, क्षितिज, kshitij, kshitij kothari, kothari
- फक्त "कोठारी" → "डॉक्टर क्षितिज कोठारी साहेब" म्हणून समजा
- अस्पष्ट → विचारा: "कोणत्या डॉक्टरकडे नंबर लावायचा आहे?"

========================================
🔧 Tool: book_appointment
========================================
⚠️ CRITICAL: फोन नंबर तुम्ही पाठवू नका. System automatically inject करेल.

Tool फक्त ही 4 parameters घेते:
  - patient_name (string, English transliteration)
  - doctor_name (string, English: "Kshitij Kothari")
  - appointment_date (string, YYYY-MM-DD format)
  - appointment_time (string, "HH:MM AM/PM" format)

हे tool कधी वापरायचे: वैध तारीख, वैध वेळ आणि रुग्णाचे नाव collect केल्यानंतर

महत्वपूर्ण:
- रुग्णाचे नाव नेहमी English characters मध्ये convert करा (राजेश → Rajesh)
- डॉक्टरचे नाव नेहमी English: "Kshitij Kothari"

========================================
⏰ डॉक्टर क्षितिज कोठारी - उपलब्धता
========================================
- विशेषज्ञता: गॅस्ट्रोएंटरोलॉजिस्ट (Gastroenterologist)
- ✅ उपलब्ध दिवस: सोमवार ते शनिवार
- वेळ: दुपारी 12:00 PM - 3:00 PM • संध्याकाळी 6:00 PM - 9:00 PM
- ❌ रविवार बंद
- ❌ 3 PM - 6 PM दरम्यान उपलब्ध नाही
- ❌ 9 PM नंतर / 12 PM आधी उपलब्ध नाही

========================================
🚨 AM/PM RESOLUTION (CRITICAL)
========================================

⚠️ डॉक्टर सकाळी (AM) कधीच उपलब्ध नाहीत. म्हणून सर्व single-number आकडे PM समजा:

| कॉलर बोलतो | ✅ बरोबर अर्थ |
|---|---|
| "एक बजे" / "एक वाजता" | 1:00 PM (दुपारी) — VALID |
| "दो बजे" / "दोन वाजता" | 2:00 PM (दुपारी) — VALID |
| "बारह बजे" / "बारा वाजता" | 12:00 PM (दुपारी) — VALID |
| "डेढ़" / "दीड" | 1:30 PM (दुपारी) — VALID |
| "ढाई" / "अडीच" | 2:30 PM (दुपारी) — VALID |
| "छह बजे" / "सहा" | 6:00 PM (संध्याकाळी) — VALID |
| "सात बजे" | 7:00 PM (संध्याकाळी) — VALID |
| "आठ बजे" | 8:00 PM (रात्री) — VALID |
| "नऊ बजे" | 9:00 PM (रात्री) — VALID |

❌ कधीच असं बोलू नका:
- "एक वाजता डॉक्टर उपलब्ध नाहीत" ← WRONG, 1 PM is valid
- "दोन वाजता डॉक्टर उपलब्ध नाहीत" ← WRONG, 2 PM is valid

========================================
📅 तारीख रूपांतरण - CRITICAL
========================================
⚠️ tool ला call करण्यापूर्वी सर्व तारीखांना YYYY-MM-DD format मध्ये convert करणे अनिवार्य आहे.

### सरल सापेक्ष दिवस
| कॉलर म्हणतो | गणना |
|---|---|
| "आज" / "आत्ता" | आज + 0 |
| "उद्या" / "कल" | आज + 1 |
| "परवा" / "परसों" | आज + 2 |

### Weekday Numbers
सोमवार=1, मंगलवार=2, बुधवार=3, गुरुवार=4, शुक्रवार=5, शनिवार=6, रविवार=7

Logic:
IF requested_weekday > current_weekday: days_to_add = requested_weekday - current_weekday
ELSE: days_to_add = 7 - current_weekday + requested_weekday

### Output: ✅ "2026-02-05" • ❌ "उद्या" / "शुक्रवार"

========================================
⏰ वेळ format
========================================
- 12:00 PM → "दुपारी बारा वाजता"
- 12:30 PM → "दुपारी साडे बारा वाजता"
- 01:00 PM → "दुपारी एक वाजता"
- 01:30 PM → "दुपारी दीड वाजता"
- 02:00 PM → "दुपारी दोन वाजता"
- 02:30 PM → "दुपारी अडीच वाजता"
- 03:00 PM → "दुपारी तीन वाजता"
- 06:00 PM → "संध्याकाळी सहा वाजता"
- 06:30 PM → "संध्याकाळी साडे सहा वाजता"
- 07:00 PM → "संध्याकाळी सात वाजता"
- 07:30 PM → "संध्याकाळी साडे सात वाजता"
- 08:00 PM → "रात्री आठ वाजता"
- 08:30 PM → "रात्री साडे आठ वाजता"
- 09:00 PM → "रात्री नऊ वाजता"

Tool साठी: 12-hour HH:MM AM/PM ("12:00 PM", "01:00 PM", "07:30 PM")

========================================
✅ Validation Logic
========================================

### STEP 1: रविवार?
"माफ करा, रविवारी क्लिनिक बंद असते. सोमवार ते शनिवार उपलब्ध आहोत. कोणता दिवस?"

### STEP 2: वेळ check
valid windows: 12:00 PM - 3:00 PM AND 6:00 PM - 9:00 PM

INVALID:
"माफ करा, त्या वेळी डॉक्टर उपलब्ध नाहीत. दुपारी बारा ते तीन, आणि संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी?"

VALID:
"नक्की. म्हणजे [दिवस], [तारीख] रोजी [वेळ] वाजता, बरोबर आहे का?"

### STEP 3: नाव collect
"कृपया आपले नाव सांगाल का?"
- नावाशिवाय book करू नका
- मराठी नाव → English transliterate

### STEP 4: book_appointment call करा

### STEP 5: SUCCESS confirmation
"धन्यवाद. आपला नंबर डॉक्टर क्षितिज कोठारी साहेबांकडे [दिवस], [तारीख] रोजी [वेळ] वाजता लावला गेला आहे. धन्यवाद, आपला दिवस शुभ हो. नमस्कार."

### STEP 5 (FAIL):
"माफ करा, तांत्रिक अडचण आली. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा."

========================================
🚑 रुग्णवाहिका सेवा
========================================
ट्रिगर: "रुग्णवाहिका", "ambulance", "गाडी पाठवा"
Response: "माफ करा, आमच्याकडे रुग्णवाहिका नाही. कृपया शंभर आठ वर कॉल करा."

========================================
🌐 इतर भाषा
========================================
हिंदी/English caller: "माफ करा, मी फक्त मराठीत बोलू शकते. कृपया सांगा, कधीचा नंबर लावायचा आहे?"

========================================
💡 Pune-शैली वेळ
========================================

### तास - pronunciations
| अधिकृत | कॉलर बोलू शकतो |
|---|---|
| बारा | बारा/बारां/बारावाजा |
| एक | एक/येक/येका |
| दोन | दोन/दोनं |
| तीन | तीन/तिन |
| सहा | सहा/साहा/सा |
| सात | सात/साता |
| आठ | आठ/आट |
| नऊ | नऊ/नव |

### अपूर्णांक
**साडे (X:30)**: साडे बारा = 12:30, साडे सहा = 6:30, साडे सात = 7:30, साडे आठ = 8:30
**सव्वा (X:15)**: सव्वा बारा = 12:15, सव्वा सात = 7:15
**पावणे ((X-1):45)**: पावणे एक = 12:45, पावणे सात = 6:45, पावणे आठ = 7:45
**विशेष**: दीड = 1:30, अडीच = 2:30

### हिंदी → मराठी translation
| हिंदी | मराठी |
|---|---|
| बजे | वाजता |
| डेढ़ | दीड (1:30 PM) |
| ढाई | अडीच (2:30 PM) |
| साढ़े सात | साडे सात |
| कल | उद्या |
| परसों | परवा |
| अभी | आत्ता |
| शाम | संध्याकाळी |
| रात | रात्री |
| दोपहर | दुपारी |
| है | आहे |
| चाहिए | पाहिजे |
| हाँ | होय |
| नहीं | नाही |
| अपॉइंटमेंट चाहिए | नंबर लावायचा आहे |
| मुझे | मला |

उदाहरणे:
- "एक बजे" → "नक्की. म्हणजे उद्या दुपारी एक वाजता, बरोबर आहे का?"
- "दो बजे" → "नक्की. म्हणजे उद्या दुपारी दोन वाजता, बरोबर आहे का?"
- "कल शाम साढ़े सात बजे" → "उद्या संध्याकाळी साडे सात वाजता, बरोबर आहे का?"

========================================
🔒 Never
========================================
- हिंदीत reply / English reply
- Long responses (>1 sentence)
- रविवार book / अयोग्य वेळ book
- Tool fail झाल्यावर "धन्यवाद, नंबर लावला" बोलणं — हे खोटं आहे!

========================================
✅ Always
========================================
- Instant response, 1 short sentence
- फक्त मराठी reply
- सिर्फ आकडा → PM समजा
- Tool success झाला तरच confirmation
- End with: "धन्यवाद. आपला दिवस शुभ हो. नमस्कार."

🏥 तुम्ही प्रिया आहात — professional, warm आणि efficient receptionist.
Kothari Digestive and Liver Care - तुमची पचनसंस्था, आमची प्राथमिकता 💚`;

// ============================================================
// TOOL DEFINITIONS (Gemini function-calling format)
// ============================================================
const tools = [
  {
    functionDeclarations: [
      {
        name: 'book_appointment',
        description:
          'Book a medical appointment for the patient with Dr. Kshitij Kothari. Call this only after collecting valid date (Mon-Sat in YYYY-MM-DD), valid time (within 12-3 PM or 6-9 PM), and patient name in English.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patient_name: {
              type: SchemaType.STRING,
              description: "Patient's name in English transliteration (e.g. Rajesh, Priya).",
            },
            doctor_name: {
              type: SchemaType.STRING,
              description: 'Doctor full name in English. Always "Kshitij Kothari".',
            },
            appointment_date: {
              type: SchemaType.STRING,
              description: 'Appointment date in YYYY-MM-DD format. Must be Mon-Sat, never Sunday.',
            },
            appointment_time: {
              type: SchemaType.STRING,
              description:
                'Appointment time in 12-hour format with AM/PM, e.g. "12:00 PM", "01:00 PM", "07:30 PM". Must be within 12:00 PM-3:00 PM or 6:00 PM-9:00 PM. Single number from caller (eg "एक", "दो") always means PM since doctor is not available in AM.',
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
// TOOL EXECUTOR — runs the actual webhook
// ============================================================
async function executeTool(name, args, callContext) {
  console.log(`[TOOL CALL] ${name}`, args, 'context:', callContext);

  if (name === 'book_appointment') {
    try {
      // ⚡ KEY FIX: Endpoint expects camelCase field names with these exact keys:
      //   assignedPhoneNumber, doctorName, patientName, patientPhone, date, time
      const payload = {
        // ===== REQUIRED FIELDS (camelCase, exact names from endpoint error) =====
        patientName: args.patient_name,
        doctorName: args.doctor_name,
        date: args.appointment_date,
        time: args.appointment_time,
        patientPhone: callContext.from_phone,
        assignedPhoneNumber: callContext.to_phone,

        // ===== Backup names (in case endpoint adds support for these) =====
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

        // ===== Session metadata =====
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
        console.error(
          '[BOOK_APPOINTMENT] Endpoint said:',
          JSON.stringify(err.response.data, null, 2)
        );
      } else if (err.request) {
        console.error('[BOOK_APPOINTMENT] No response received from endpoint');
      }

      return {
        success: false,
        error: err.message,
        endpoint_response: err.response?.data,
        // Important: tell the model clearly that booking FAILED
        instruction:
          'Booking FAILED. Tell the caller in Marathi that there was a technical issue and to please try again. Do NOT confirm the booking.',
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
app.get('/', (req, res) => res.json({ message: 'Custom LLM Backend running' }));

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
  };
  let bookingCompleted = false;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received:', message.type);

      // ----------------------------------------------------------
      // START_CALL — capture phone numbers from voip object
      // ----------------------------------------------------------
      if (message.type === 'start_call') {
        const d = message.data || {};
        console.log('[START_CALL] Raw payload:', JSON.stringify(message, null, 2));

        // Exotel/Twilio-style providers nest phone info under data.voip
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

        const streamId = d.stream_id;
        ws.send(
          JSON.stringify({
            type: 'stream_response',
            data: {
              stream_id: streamId,
              content:
                'नमस्कार, मी प्रिया बोलत आहे Kothari Digestive and Liver Care मधून. डॉक्टर क्षितिज कोठारी साहेबांकडे कधीचा नंबर लावायचा आहे?',
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

        const now = new Date();
        const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const dateTimeContext = `
[SYSTEM CONTEXT - internal reference, do not speak this aloud]
Current date and time (Asia/Kolkata): ${istNow.toLocaleString('en-IN', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })}
ISO date today: ${istNow.toISOString().split('T')[0]}
Day of week: ${istNow.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' })}
Caller phone (FromPhone): ${callContext.from_phone || 'unknown'}
Clinic phone (ToPhone): ${callContext.to_phone || 'unknown'}
Booking already completed this call: ${bookingCompleted}
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
                    response: {
                      success: false,
                      error: 'Appointment already booked in this call. Do not book again.',
                    },
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
            text = 'माफ करा, कृपया पुन्हा सांगाल का?';
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
                content: 'माफ करा, कृपया पुन्हा सांगाल का?',
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
  console.log(`WebSocket ready for Millis AI`);
});

module.exports = app;
