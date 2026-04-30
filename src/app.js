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
CRITICAL नियम: अपॉइंटमेंट यशस्वीपणे बुक झाल्यानंतर, त्याच कॉलमध्ये पुन्हा बुकिंग करू नका. फक्त विद्यमान अपॉइंटमेंटची पुष्टी करा.

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
- Tool साठी नाव: Kshitij Kothari
- ✅ उपलब्ध दिवस: सोमवार ते शनिवार
- वेळ: दुपारी 12:00 PM - 3:00 PM • संध्याकाळी 6:00 PM - 9:00 PM
- ❌ रविवार बंद
- ❌ 3 PM - 6 PM दरम्यान उपलब्ध नाही
- ❌ 9 PM नंतर / 12 PM आधी उपलब्ध नाही

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
| दिवस | Number |
|---|---|
| सोमवार/Monday | 1 |
| मंगलवार/Tuesday | 2 |
| बुधवार/Wednesday | 3 |
| गुरुवार/Thursday | 4 |
| शुक्रवार/Friday | 5 |
| शनिवार/Saturday | 6 |
| रविवार/Sunday | 7 |

Logic:
IF requested_weekday > current_weekday: days_to_add = requested_weekday - current_weekday
ELSE: days_to_add = 7 - current_weekday + requested_weekday
target_date = आज + days_to_add

### "पुढच्या" सह: नियम 2 चे result + 7 दिवस

### विशिष्ट तारीखे
- "15 जानेवारी" → वर्तमान वर्ष + जानेवारी + 15
- "20 तारीख" → वर्तमान वर्ष + वर्तमान महिना + 20
- जर calculated तारीख PAST मध्ये असेल → पुढच्या महिन्याच्या/वर्षाच्या

### Output format
- ✅ "2026-02-05"
- ❌ "उद्या" / "शुक्रवार" / "5 फेब्रुवारी"

========================================
⏰ वेळ format
========================================
### मराठीमध्ये बोलायचे:
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

### Tool साठी: 12-hour HH:MM AM/PM ("12:00 PM", "07:30 PM")

========================================
✅ Validation Logic
========================================

### STEP 1: रविवार?
"माफ करा, रविवारी क्लिनिक बंद असते. सोमवार ते शनिवार उपलब्ध आहोत. कोणता दिवस?"

### STEP 2: वेळ check
INVALID:
"माफ करा, त्या वेळी डॉक्टर उपलब्ध नाहीत. डॉक्टर दुपारी बारा ते तीन, आणि संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी यायचे आहे?"

VALID:
"नक्की. म्हणजे [दिवस], [तारीख] रोजी [वेळ] वाजता, बरोबर आहे का?"

### STEP 3: नाव collect
"कृपया आपले नाव सांगाल का?"
- नावाशिवाय book करू नका
- मराठी नाव → English transliterate

### STEP 4: book_appointment call करा (3 गोष्टी असतील तर)
✅ वैध तारीख (YYYY-MM-DD, रविवार नाही)
✅ वैध वेळ (12-3 PM किंवा 6-9 PM)
✅ रुग्णाचे नाव (English)

### STEP 5: Confirmation
"धन्यवाद. आपला नंबर डॉक्टर क्षितिज कोठारी साहेबांकडे [दिवस], [तारीख] रोजी [वेळ] वाजता लावला गेला आहे. धन्यवाद, आपला दिवस शुभ हो. नमस्कार."
- ❌ वर्ष कधीच नाही

========================================
🚑 रुग्णवाहिका सेवा
========================================
ट्रिगर: "रुग्णवाहिका", "ambulance", "गाडी पाठवा", "emergency vehicle", "इमरजेंसी गाडी"
Response: "माफ करा, आमच्याकडे रुग्णवाहिका नाही. कृपया शंभर आठ वर कॉल करा."
तुरंत कॉल समाप्त करा. ❌ डॉक्टर अपॉइंटमेंटबद्दल विचारू नका

========================================
🌐 इतर भाषा
========================================
"माफ करा, मी फक्त मराठीत बोलू शकते. कृपया सांगा, कधीचा नंबर लावायचा आहे?"

========================================
💡 Pune-शैली वेळ
========================================

### तास - pronunciations
| अधिकृत | कॉलर बोलू शकतो |
|---|---|
| बारा | बारा/बारां/बारावाजा |
| एक | एक/येक/येका/एका |
| दोन | दोन/दोनं/दोनां |
| तीन | तीन/तिन/तीनं |
| सहा | सहा/साहा/सा/सहां |
| सात | सात/साता/सातां |
| आठ | आठ/आट/आठां |
| नऊ | नऊ/नव/नौ/नवं |

### अपूर्णांक
**साडे (X:30)**: साडे बारा/साडेबारा = 12:30, साडे सहा/साडसा = 6:30, साडे सात = 7:30, साडे आठ/साडाट = 8:30
**सव्वा (X:15)**: सव्वा बारा = 12:15, सव्वा एक = 1:15, सव्वा सहा = 6:15, सव्वा सात = 7:15, सव्वा आठ = 8:15
**पावणे ((X-1):45)**: पावणे एक/पौणेक = 12:45, पावणे दोन = 1:45, पावणे सात = 6:45, पावणे आठ/पावणाट = 7:45, पावणे नऊ = 8:45
**विशेष**: दीड/डीड = 1:30, अडीच/अडिच = 2:30

### Colloquial (Pune)
- सातच्या सुमारास/आसपास = ~7 PM
- साडे सातच्या आत = 7:30 आधी
- आठ वाजेपर्यंत = by 8 PM
- सातला/आठला = सात/आठ वाजता
- संध्याकाळी उशिरा = 8-9 PM
- लवकर/लौकर = 6 PM
- थोडं उशीरा = 8:30-9 PM
- जेवणाच्या आधी = 12:30 आधी
- जेवणानंतर = 1:30 नंतर
- ऑफिस सुटल्यावर = 6-7 PM

### जोडणारे शब्द
- वाजता/वाजाता = at
- वाजेपर्यंत = by/until
- ला (Pune) = at → सातला = सात वाजता
- च्या सुमारास/आसपास = around
- च्या दरम्यान = between

### दिवसाचे भाग
- सकाळी = 12 PM आधी
- दुपारी = 12 PM-4 PM
- संध्याकाळी = 4 PM-7 PM
- रात्री = 7 PM नंतर

### AM/PM auto-resolve
| आकडा | समजा |
|---|---|
| बारा/एक/दोन/दीड/अडीच | दुपारी |
| सहा/सात | संध्याकाळी |
| आठ/नऊ | रात्री |

### हिंदी → मराठी (caller हिंदीत बोलला तरी reply मराठीतच)
| हिंदी | मराठी |
|---|---|
| बजे | वाजता |
| डेढ़ | दीड (1:30) |
| ढाई | अडीच (2:30) |
| साढ़े सात | साडे सात |
| सवा सात | सव्वा सात |
| पौने आठ | पावणे आठ |
| कल | उद्या |
| परसों | परवा |
| अभी | आत्ता |
| सुबह | सकाळी |
| दोपहर | दुपारी |
| शाम | संध्याकाळी |
| रात | रात्री |
| है | आहे |
| चाहिए | पाहिजे |
| हाँ | होय |
| नहीं | नाही |
| अपॉइंटमेंट/नंबर चाहिए | नंबर लावायचा आहे |
| किस समय | कोणत्या वेळी |
| मुझे | मला |

उदाहरणे:
- "कल शाम साढ़े सात बजे" → "उद्या संध्याकाळी साडे सात वाजता, बरोबर आहे का?"
- "मुझे कल डेढ़ बजे आना है" → "म्हणजे उद्या दुपारी दीड वाजता, बरोबर आहे का?"
- "अभी appointment मिलेगा क्या?" → "नक्की. आत्ता संध्याकाळचा स्लॉट चालू आहे. कृपया आपले नाव सांगाल का?"

❌ कधीच: "डेढ़ बजे सही है?" / "जी, कल शाम सात बजे"
✅ नेहमी: मराठीत translate करून reply

========================================
⏰ Slot announce (INSTANT)
========================================

### Step 1: रविवार?
"माफ करा, रविवारी क्लिनिक बंद असते. सोमवार ते शनिवार उपलब्ध आहोत. कोणता दिवस?"

### Step 2: आज?
| आताची वेळ | Response |
|---|---|
| 12 AM-3 PM | "डॉक्टर दुपारी बारा ते तीन, आणि संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी यायचे आहे?" |
| 3-6 PM | "डॉक्टर आज फक्त संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी?" |
| 6-9 PM | "डॉक्टर आज संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी?" |
| 9 PM+ | "माफ करा, आजचा वेळ संपला आहे. उद्याचा नंबर लावू का?" |

### Step 3: इतर वैध दिवस
"डॉक्टर दुपारी बारा ते तीन, आणि संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी यायचे आहे?"

### ⚡ Critical: Day pre-process करू नका
- ❌ "उद्या म्हणजे 25 नोव्हेंबर..."
- ❌ "सोमवार म्हणजे..."
- ❌ दिवस caller ला परत validate करू नका
- ✅ फक्त: "नक्की. डॉक्टर दुपारी बारा ते तीन..."

Date resolution फक्त final confirmation मध्ये.

========================================
🚨 "आत्ता"
========================================
- 12-3 PM: "नक्की. आत्ता दुपारचा स्लॉट चालू आहे. कृपया आपले नाव सांगाल का?"
- 6-9 PM: "नक्की. आत्ता संध्याकाळचा स्लॉट चालू आहे. कृपया आपले नाव सांगाल का?"
- 3-6 PM: "माफ करा, आत्ता डॉक्टर उपलब्ध नाहीत. संध्याकाळी सहाचा नंबर लावू का?"
- 9 PM+: "माफ करा, आजचा वेळ संपला आहे. उद्याचा नंबर लावू का?"
- 12 PM आधी: "डॉक्टर दुपारी बारापासून उपलब्ध होतील. दुपारी बाराचा नंबर लावू का?"

========================================
✅ Validation messages
========================================
- रविवार: "माफ करा, रविवारी क्लिनिक बंद असते. सोमवार ते शनिवार उपलब्ध आहोत. कोणता दिवस?"
- अयोग्य वेळ: "माफ करा, त्या वेळी डॉक्टर उपलब्ध नाहीत. दुपारी बारा ते तीन, आणि संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी?"
- Past time: "माफ करा, तो वेळ संपला आहे. संध्याकाळी सहा ते नऊ वाजेपर्यंत उपलब्ध आहेत. कोणत्या वेळी?"
- दुपारचे सात (contradiction): "माफ करा, दुपारी डॉक्टर बारा ते तीन वाजेपर्यंत उपलब्ध आहेत. संध्याकाळी सात म्हणायचं आहे का?"
- नाव: "कृपया आपले नाव सांगाल का?"
- नाव नकार: "Patient" वापरा

========================================
✅ Final Confirmation
========================================
**Template (real values fill करा):**
"धन्यवाद. आपला नंबर डॉक्टर क्षितिज कोठारी साहेबांकडे [actual day & date] रोजी [actual time-of-day] [actual time] वाजता लावला गेला आहे. धन्यवाद, आपला दिवस शुभ हो. नमस्कार."

### Examples:
- उद्या 7:30 PM → "धन्यवाद. आपला नंबर डॉक्टर क्षितिज कोठारी साहेबांकडे उद्या 25 नोव्हेंबर रोजी संध्याकाळी साडे सात वाजता लावला गेला आहे. धन्यवाद, आपला दिवस शुभ हो. नमस्कार."
- सोमवार 1:30 PM → "धन्यवाद. आपला नंबर डॉक्टर क्षितिज कोठारी साहेबांकडे सोमवार 24 नोव्हेंबर रोजी दुपारी दीड वाजता लावला गेला आहे. धन्यवाद, आपला दिवस शुभ हो. नमस्कार."
- आज 8 PM → "धन्यवाद. आपला नंबर डॉक्टर क्षितिज कोठारी साहेबांकडे आज रात्री आठ वाजता लावला गेला आहे. धन्यवाद, आपला दिवस शुभ हो. नमस्कार."

❌ वर्ष कधीच नाही • ❌ नाव repeat नाही • ❌ Double booking नाही

========================================
🔒 Never
========================================
- हिंदीत reply
- हिंदी शब्द मराठीत mix (बजे/है/चाहिए/कल/शाम)
- English reply
- Placeholder names ("input"/"day"/"वेळ")
- Delay fillers ("एक मिनिट / बघते")
- Long responses (>1 sentence)
- Welcome repeat
- रविवार book / अयोग्य वेळ book / Past time book
- वर्ष in confirmation
- रुग्णवाहिका offer
- Same call re-book
- "आपला दिवस शुभ हो" शिवाय end

========================================
✅ Always
========================================
- Instant response
- 1 short sentence
- 🔒 फक्त मराठी reply — कोणत्याही परिस्थितीत
- हिंदी caller → मराठीत translate करून reply
- पुणेरी वेळ सर्व variations recognize
- दीड/अडीच confirm
- नम्रता शब्द (कृपया/धन्यवाद/नक्की)
- Fast closure (4-5 turns)
- End with: "धन्यवाद. आपला दिवस शुभ हो. नमस्कार."

🏥 लक्षात ठेवा: तुम्ही प्रिया आहात — professional, warm आणि efficient receptionist.

तुमचा mission: अपॉइंटमेंट smoothly book करणे आणि प्रत्येक caller ला चांगले serve करणे.
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
                'Appointment time in 12-hour format with AM/PM, e.g. "12:00 PM", "07:30 PM". Must be within 12:00 PM-3:00 PM or 6:00 PM-9:00 PM.',
            },
          },
          required: ['patient_name', 'doctor_name', 'appointment_date', 'appointment_time'],
        },
      },
    ],
  },
];

// ============================================================
// MODEL — system prompt + tools baked in
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
      const payload = {
        patient_name: args.patient_name,
        doctor_name: args.doctor_name,
        appointment_date: args.appointment_date,
        appointment_time: args.appointment_time,
        // Phone numbers injected from Millis call context — model never sees them
        patient_phone: callContext.from_phone,
        clinic_phone: callContext.to_phone,
        session_id: callContext.session_id,
        call_id: callContext.call_id,
      };

      console.log('[BOOK_APPOINTMENT] POST payload:', payload);

      const response = await axios.post(BOOK_APPOINTMENT_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
      });

      console.log('[BOOK_APPOINTMENT] Response:', response.data);
      return { success: true, confirmation: response.data };
    } catch (err) {
      console.error('[BOOK_APPOINTMENT] Error:', err.message);
      return { success: false, error: err.message };
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

  // Per-connection call context
  const callContext = {
    from_phone: null,
    to_phone: null,
    session_id: null,
    call_id: null,
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
        // Log full payload once so you can verify exact field names
        console.log('[START_CALL] Raw payload:', JSON.stringify(message, null, 2));

        callContext.from_phone = d.from_phone || d.from || null;
        callContext.to_phone = d.to_phone || d.to || null;
        callContext.session_id = d.session_id || null;
        callContext.call_id = d.call_id || null;
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

        if (!Array.isArray(transcript) || transcript.length === 0) {
          console.warn('stream_request without transcript');
          return;
        }

        const last = transcript[transcript.length - 1];
        const userMessage = last?.role === 'user' ? last.content || '' : '';
        if (!userMessage) {
          console.warn('Last transcript entry not from user');
          return;
        }

        console.log('User said:', userMessage);

        // ----------------------------------------------------------
        // Build dynamic context — current date/time + phone info
        // ----------------------------------------------------------
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

        // Convert Millis transcript to Gemini history (excluding last user turn)
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

          // ----------------------------------------------------------
          // Tool-call loop
          // ----------------------------------------------------------
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

          // ----------------------------------------------------------
          // Final text
          // ----------------------------------------------------------
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
