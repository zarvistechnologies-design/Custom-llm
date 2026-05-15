const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const WebSocket = require('ws');
require('dotenv').config();

const { handleConnection } = require('./handlers/websocketHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json({ limit: '5mb' })); // higher limit for large prompts
app.use(express.urlencoded({ extended: true }));

// ============================================================
// ROUTES
// ============================================================
app.get('/', (req, res) => {
  res.json({
    message: 'Multi-Clinic Voice Agent Backend',
    tools: [
      'book_appointment',
      'check_doctor_availability',
      'get_doctors',
      'lookup_order',
      'create_support_ticket',
      'transfer_to_service_agent',
      'send_post_call_message',
      'check_demo_slots',
      'book_live_demo',
    ],
    modules: { custom_llm_ws: 'ws://localhost:3000/' },
    optimizations: ['MongoDB-based prompts', 'streaming with flush', 'in-memory cache'],
  });
});

app.use('/api/health', require('./routes/health'));

// ============================================================
// MONGODB CONNECTION
// ============================================================
async function connectDB() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not set — server will use default config only');
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ MongoDB connected: ${mongoose.connection.name}`);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('   Server will use default config as fallback');
  }
}

mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));

// ============================================================
// HTTP + WEBSOCKET SERVER
// ============================================================
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', handleConnection);

// ============================================================
// START
// ============================================================
async function start() {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 WebSocket ready at ws://localhost:${PORT}`);
    console.log(`🩺 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔧 Tools: book_appointment, check_doctor_availability, get_doctors`);
  });
}

start();

module.exports = app;
