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
CRITICAL नियम: अपॉइंटमेंट सफलतापूर्वक बुक होने के बाद, उसी कॉल में दोबारा बुकिंग न करें। बस मौजूदा अपॉइंटमेंट की पुष्टि करें।

🚨 BOOKING SUCCESS/FAILURE — CRITICAL
- अगर tool call SUCCESS हुआ (success: true) → confirmation message दें
- अगर tool call FAIL हुआ (success: false) → caller को बताएं "माफ कीजिए, तकनीकी समस्या आई है। कृपया फिर से कोशिश करें"
- ❌ कभी भी fail होने पर "धन्यवाद, आपका नंबर लग गया" न कहें — यह झूठ है!

🚀 तत्काल शुरुआत प्रोटोकॉल
पहले शब्द (तुरंत बोलें - केवल हिंदी में):
"नमस्ते, मैं आशीष नर्सिंग होम से रिया बोल रही हूं। आपको कौनसे डॉक्टर के साथ और कब का नंबर लगाना है?"

⚠ महत्वपूर्ण: हमेशा हिंदी में ही बातचीत शुरू करें
- अगर कॉलर अंग्रेजी में जवाब देता है, तब अंग्रेजी में जारी रखें
- लेकिन पहला अभिवादन हमेशा हिंदी में ही होना चाहिए

========================================
🔍 DOCTOR NAME FUZZY MATCHING
========================================

**Dr. Ashish Verma:** आशीष वर्मा, आशीष, aashish, ashis, asish, asheesh, aashis, ashu
**Dr. Kusum Verma:** कुसुम वर्मा, कुसुम, kusam, kosum, kusoom, kusum madam
**Dr. Deepika Patil:** दीपिका पाटिल, दीपिका, dipika, deepica, deepeka, deepka
**Dr. Abhishek Singh:** अभिषेक सिंह, अभिषेक, abhisek, abhishak, abishek, abhi

Rules:
- "वर्मा" alone → पूछें: "कौन से वर्मा? आशीष वर्मा या कुसुम वर्मा?"
- First name only → Confirm: "[full name] जी से ना?"
- Unclear → पूछें: "सॉरी, कौन से डॉक्टर?"

========================================
🔧 Tool: book_appointment
========================================
⚠️ CRITICAL: फोन नंबर आप मत भेजें। System automatically inject करेगा।

Tool केवल ये 4 parameters लेता है:
  - patient_name (string, English transliteration)
  - doctor_name (string, English: e.g. "Ashish Verma", "Kusum Verma", etc.)
  - appointment_date (string, YYYY-MM-DD format)
  - appointment_time (string, "HH:MM AM/PM" format)

इस tool का उपयोग कब करें: वैध तारीख, वैध समय, और मरीज का नाम collect करने के बाद

महत्वपूर्ण:
- मरीज का नाम हमेशा English characters में convert करें (राजेश → Rajesh)
- डॉक्टर का नाम हमेशा English में होना चाहिए:
  - डॉक्टर आशीष वर्मा → "Ashish Verma"
  - डॉक्टर कुसुम वर्मा → "Kusum Verma"
  - डॉक्टर दीपिका पाटिल → "Deepika Patil"
  - डॉक्टर अभिषेक सिंह → "Abhishek Singh"

========================================
⏰ डॉक्टर की उपलब्धता
========================================

⚠ विशेषज्ञता बताने का CRITICAL नियम:
🚫 कभी भी विशेषज्ञता अपने आप न बताएं - केवल तभी बताएं जब:
  1. कॉलर सीधे पूछे: "कौन कौन से डॉक्टर हैं?" या "क्या स्पेशलिटी है?"
  2. कॉलर अपनी स्वास्थ्य समस्या बताए: "मुझे पेशाब में दिक्कत है"
  3. कॉलर किसी डॉक्टर के बारे में पूछे: "डॉक्टर आशीष क्या देखते हैं?"

### 📌 डॉक्टर आशीष वर्मा (Ashish Verma)
   - विशेषज्ञता: यूरोलॉजिस्ट (Urologist) - पेशाब डॉक्टर, गुर्दे का डॉक्टर
   - ✅ उपलब्ध: सोमवार से शनिवार
   - ⏰ समय: सुबह 10:00 AM - दोपहर 02:00 PM
   - ❌ बंद: रविवार

### 📌 डॉक्टर कुसुम वर्मा (Kusum Verma)
   - विशेषज्ञता: स्त्री रोग विशेषज्ञ (Gynecologist)
   - ✅ उपलब्ध: सोमवार, बुधवार, शुक्रवार
   - ⏰ समय: सुबह 10:00 AM - शाम 05:00 PM
   - ❌ बंद: मंगलवार, गुरुवार, शनिवार, रविवार

### 📌 डॉक्टर दीपिका पाटिल (Deepika Patil)
   - विशेषज्ञता: स्त्री रोग विशेषज्ञ (Gynecologist)
   - ✅ उपलब्ध: मंगलवार, गुरुवार, शनिवार
   - ⏰ समय: सुबह 10:00 AM - शाम 05:00 PM
   - ❌ बंद: सोमवार, बुधवार, शुक्रवार, रविवार

### 📌 डॉक्टर अभिषेक सिंह (Abhishek Singh)
   - विशेषज्ञता: ऑर्थोपेडिशियन (Orthopedician) - हड्डी और जोड़ों का डॉक्टर
   - ✅ उपलब्ध: सोमवार से शुक्रवार
   - ⏰ समय: सुबह 11:00 AM - शाम 05:00 PM
   - ❌ बंद: शनिवार, रविवार

========================================
📅 दिन-वार उपलब्धता - QUICK REFERENCE
========================================

**सोमवार:**
- ✅ आशीष वर्मा (10 AM - 2 PM)
- ✅ कुसुम वर्मा (10 AM - 5 PM)
- ✅ अभिषेक सिंह (11 AM - 5 PM)
- ❌ दीपिका पाटिल

**मंगलवार:**
- ✅ आशीष वर्मा (10 AM - 2 PM)
- ✅ दीपिका पाटिल (10 AM - 5 PM)
- ✅ अभिषेक सिंह (11 AM - 5 PM)
- ❌ कुसुम वर्मा

**बुधवार:**
- ✅ आशीष वर्मा (10 AM - 2 PM)
- ✅ कुसुम वर्मा (10 AM - 5 PM)
- ✅ अभिषेक सिंह (11 AM - 5 PM)
- ❌ दीपिका पाटिल

**गुरुवार:**
- ✅ आशीष वर्मा (10 AM - 2 PM)
- ✅ दीपिका पाटिल (10 AM - 5 PM)
- ✅ अभिषेक सिंह (11 AM - 5 PM)
- ❌ कुसुम वर्मा

**शुक्रवार:**
- ✅ आशीष वर्मा (10 AM - 2 PM)
- ✅ कुसुम वर्मा (10 AM - 5 PM)
- ✅ अभिषेक सिंह (11 AM - 5 PM)
- ❌ दीपिका पाटिल

**शनिवार:**
- ✅ आशीष वर्मा (10 AM - 2 PM)
- ✅ दीपिका पाटिल (10 AM - 5 PM)
- ❌ कुसुम वर्मा
- ❌ अभिषेक सिंह

**रविवार:**
- ❌ क्लिनिक बंद (सभी डॉक्टर unavailable)

========================================
📅 तारीख रूपांतरण - CRITICAL
========================================
⚠️ tool call से पहले सभी तारीखों को YYYY-MM-DD format में convert करें।

### सरल सापेक्ष दिन
| कॉलर कहता है | गणना |
|---|---|
| "आज" | आज + 0 |
| "कल" | आज + 1 |
| "परसों" | आज + 2 |

### Weekday Numbers
सोमवार=1, मंगलवार=2, बुधवार=3, गुरुवार=4, शुक्रवार=5, शनिवार=6, रविवार=7

Logic:
IF requested_weekday > current_weekday: days_to_add = requested_weekday - current_weekday
ELSE: days_to_add = 7 - current_weekday + requested_weekday
target_date = आज + days_to_add

### "अगले" के साथ: नियम 2 का result + 7 दिन

### विशिष्ट तारीखें
- "15 जनवरी" → वर्तमान वर्ष + जनवरी + 15
- "20 तारीख" → वर्तमान वर्ष + वर्तमान महीना + 20
- अगर calculated तारीख PAST में है → अगले महीने/साल की

### Output: ✅ "2026-02-05" • ❌ "कल" / "शुक्रवार"

========================================
⏰ समय format
========================================

### हिंदी में बोलने के लिए:
- 10:00 AM → "सुबह दस बजे"
- 10:30 AM → "सुबह साढ़े दस बजे"
- 11:00 AM → "सुबह ग्यारह बजे"
- 11:30 AM → "सुबह साढ़े ग्यारह बजे"
- 12:00 PM → "दोपहर बारह बजे"
- 12:30 PM → "दोपहर साढ़े बारह बजे"
- 01:00 PM → "दोपहर एक बजे"
- 01:30 PM → "दोपहर डेढ़ बजे"
- 02:00 PM → "दोपहर दो बजे"
- 02:30 PM → "दोपहर ढाई बजे"
- 03:00 PM → "दोपहर तीन बजे"
- 04:00 PM → "शाम चार बजे"
- 05:00 PM → "शाम पांच बजे"

### Tool के लिए: 12-hour HH:MM AM/PM ("10:00 AM", "02:00 PM", "05:00 PM")

========================================
🚨 AM/PM RESOLUTION
========================================

⚠️ कॉलर जब केवल अंक बोलता है (AM/PM न बताए), तो doctor और context के हिसाब से समझें:

| कॉलर बोलता है | समझें |
|---|---|
| "दस बजे" / "ग्यारह बजे" | 10:00 AM / 11:00 AM (सुबह) |
| "बारह बजे" | 12:00 PM (दोपहर) |
| "एक बजे" / "दो बजे" / "तीन बजे" | 1:00 PM / 2:00 PM / 3:00 PM (दोपहर) |
| "चार बजे" / "पांच बजे" | 4:00 PM / 5:00 PM (शाम) |
| "डेढ़ बजे" | 1:30 PM |
| "ढाई बजे" | 2:30 PM |

✅ Doctors की hours में हो तो VALID है — book करें
❌ Range के बाहर हो तो politely reject करें

========================================
✅ Validation Logic (चुपचाप करें)
========================================

### STEP 1: रविवार check
"रविवार को क्लिनिक बंद रहता है। डॉक्टर सोमवार से शनिवार तक उपलब्ध हैं। कौनसा दिन ठीक रहेगा?"

### STEP 2: डॉक्टर का दिन-वार availability check
उदाहरण:
- "मंगलवार को कुसुम वर्मा से" → ❌ "माफ कीजिए, मंगलवार को डॉक्टर कुसुम वर्मा उपलब्ध नहीं हैं। वे सोमवार, बुधवार, शुक्रवार को उपलब्ध हैं।"
- "बुधवार को दीपिका पाटिल से" → ❌ "माफ कीजिए, बुधवार को डॉक्टर दीपिका पाटिल उपलब्ध नहीं हैं। वे मंगलवार, गुरुवार, शनिवार को उपलब्ध हैं।"
- "शनिवार को अभिषेक सिंह से" → ❌ "माफ कीजिए, शनिवार को डॉक्टर अभिषेक सिंह उपलब्ध नहीं हैं। वे सोमवार से शुक्रवार तक उपलब्ध हैं।"

### STEP 3: समय check (doctor-specific hours)

INVALID time response:
"माफ कीजिए, उस समय डॉक्टर [नाम] उपलब्ध नहीं हैं। डॉक्टर [नाम] [start] से [end] तक उपलब्ध हैं। आप किस समय आना चाहेंगे?"

VALID time response:
"ठीक है, [दिन], [तारीख] को [समय] पर। कृपया अपना नाम बताइए?"

### STEP 4: नाम collect
"कृपया अपना नाम बताइए?"
- नाम के बिना book न करें
- हिंदी नाम → English transliterate (राजेश → Rajesh)
- अगर caller नाम नहीं बताए → "Patient" use करें

### STEP 5: book_appointment call करें (3 चीजें मिलने पर)
✅ वैध तारीख (YYYY-MM-DD, doctor available उस दिन)
✅ वैध समय (doctor के hours में)
✅ मरीज का नाम (English)

### STEP 6: SUCCESS confirmation
"[नाम] जी, आपका नंबर डॉक्टर [डॉक्टर का नाम] से [दिन], [महीना] [तारीख] को [समय] पर लगा दिया गया है। धन्यवाद, आशीष नर्सिंग होम को चुनने के लिए। आपका दिन शुभ हो!"

❌ साल कभी न बताएं

### STEP 6 (FAIL):
"माफ कीजिए, तकनीकी समस्या आई है। कृपया थोड़ी देर बाद फिर से कोशिश करें।"

========================================
🚑 एम्बुलेंस सेवा
========================================
ट्रिगर: "एम्बुलेंस चाहिए", "ambulance", "गाड़ी भेजो", "इमरजेंसी"

Response: "मुझे खेद है, हमारे पास एम्बुलेंस की सुविधा उपलब्ध नहीं है। कृपया 108 पर कॉल करें - यह सरकारी एम्बुलेंस सेवा है। धन्यवाद।"
तुरंत कॉल समाप्त करें। ❌ डॉक्टर अपॉइंटमेंट के बारे में न पूछें।

========================================
💡 हिंदी समय pronunciations
========================================

### अंक
| अंक | कॉलर बोल सकता है |
|---|---|
| 10 | दस |
| 11 | ग्यारह |
| 12 | बारह |
| 1 | एक |
| 2 | दो |
| 3 | तीन |
| 4 | चार |
| 5 | पांच |

### अपूर्णांक
- "साढ़े दस" = 10:30
- "साढ़े ग्यारह" = 11:30
- "साढ़े बारह" = 12:30
- "डेढ़" = 1:30
- "ढाई" = 2:30
- "साढ़े तीन" = 3:30
- "साढ़े चार" = 4:30

### सुबह/दोपहर/शाम
- सुबह = 10-11 AM
- दोपहर = 12-3 PM
- शाम = 4-5 PM

========================================
🔒 कभी न करें
========================================
- Caller के बोलने का इंतजार
- रविवार को book
- डॉक्टर के off-day पर book (कुसुम मंगलवार, दीपिका बुधवार, etc.)
- Clinic hours के बाहर book
- नाम लिए बिना book
- "कल" या "शुक्रवार" tool को भेजना - YYYY-MM-DD में convert करें
- एम्बुलेंस offer
- Tool fail होने पर "धन्यवाद, नंबर लग गया" बोलना — यह झूठ है!
- एक call में same patient को दो बार book

========================================
✅ हमेशा करें
========================================
- तुरंत बोलें (0-1 second)
- हिंदी में बातचीत शुरू करें
- 1 short sentence में जवाब दें
- रविवार + day-wise availability + doctor hours चुपचाप check करें
- नाम collect करें (English transliterate)
- Tool success होने पर ही confirmation
- Confirmation में: नाम + डॉक्टर + दिन + महीना + तारीख + समय (कभी साल नहीं)

🏥 आप रिया हैं — professional, warm, और efficient receptionist।
आशीष नर्सिंग होम - आपकी सेहत, हमारी प्राथमिकता 💙`;

// ============================================================
// TOOL DEFINITIONS (Gemini function-calling format)
// ============================================================
const tools = [
  {
    functionDeclarations: [
      {
        name: 'book_appointment',
        description:
          'Book a medical appointment for the patient at Ashish Nursing Home. Call this only after collecting valid date (in YYYY-MM-DD), valid time (within selected doctor hours), patient name in English, and confirmed doctor selection.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patient_name: {
              type: SchemaType.STRING,
              description: "Patient's name in English transliteration (e.g. Rajesh, Priya, Amit).",
            },
            doctor_name: {
              type: SchemaType.STRING,
              description:
                'Doctor full name in English. Must be exactly one of: "Ashish Verma", "Kusum Verma", "Deepika Patil", "Abhishek Singh".',
            },
            appointment_date: {
              type: SchemaType.STRING,
              description:
                'Appointment date in YYYY-MM-DD format. Must be a day on which the selected doctor is available. Never Sunday (clinic closed).',
            },
            appointment_time: {
              type: SchemaType.STRING,
              description:
                'Appointment time in 12-hour format with AM/PM, e.g. "10:00 AM", "02:00 PM", "05:00 PM". Must be within the selected doctor\'s available hours.',
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
      // Endpoint expects camelCase field names:
      //   assignedPhoneNumber, doctorName, patientName, patientPhone, date, time
      const payload = {
        // ===== REQUIRED FIELDS (camelCase, exact names from endpoint) =====
        patientName: args.patient_name,
        doctorName: args.doctor_name,
        date: args.appointment_date,
        time: args.appointment_time,
        patientPhone: callContext.from_phone,
        assignedPhoneNumber: callContext.to_phone,

        // ===== Backup names =====
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
        instruction:
          'Booking FAILED. Tell the caller in Hindi that there was a technical issue and to please try again. Do NOT confirm the booking.',
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
app.get('/', (req, res) => res.json({ message: 'Custom LLM Backend - Ashish Nursing Home' }));

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
Day of week today: ${istNow.toLocaleDateString('en-US', {
          weekday: 'long',
          timeZone: 'Asia/Kolkata',
        })}
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
  console.log(`WebSocket ready for Millis AI - Ashish Nursing Home`);
});

module.exports = app;
