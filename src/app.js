const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/health', require('./routes/health'));

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Custom LLM Backend' });
});

// Create HTTP server
const server = require('http').createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// WebSocket connection handler for Millis AI
wss.on('connection', (ws, req) => {
  const expectedAuth = process.env.WS_SECRET;
  const authHeader = req.headers.authorization || '';

  if (expectedAuth) {
    if (authHeader !== `Bearer ${expectedAuth}`) {
      console.warn('Unauthorized WebSocket connection attempt', authHeader);
      ws.close(1008, 'Unauthorized');
      return;
    }
  } else {
    console.warn('WS_SECRET is not configured. WebSocket auth is disabled.');
  }

  console.log('Millis AI connected');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received:', message.type);

      if (message.type === 'start_call') {
        // Handle call start
        const streamId = message.data.stream_id;
        console.log('Call started with stream ID:', streamId);

        // Send initial greeting
        ws.send(JSON.stringify({
          type: 'stream_response',
          data: {
            stream_id: streamId,
            content: 'Hello! How can I help you today?',
            end_of_stream: true
          }
        }));

      } else if (message.type === 'stream_request') {
        // Handle user message
        const streamId = message.data.stream_id;
        const transcript = message.data.transcript;

        if (transcript && transcript.length > 0) {
          const userMessage = transcript[transcript.length - 1].content;
          console.log('User message:', userMessage);

          // Generate response using Gemini
          try {
            const result = await model.generateContent(userMessage);
            const response = await result.response;
            const text = response.text();

            // Send response back to Millis AI
            ws.send(JSON.stringify({
              type: 'stream_response',
              data: {
                stream_id: streamId,
                content: text,
                end_of_stream: true
              }
            }));

          } catch (error) {
            console.error('Gemini API error:', error);
            ws.send(JSON.stringify({
              type: 'stream_response',
              data: {
                stream_id: streamId,
                content: 'Sorry, I encountered an error processing your request.',
                end_of_stream: true
              }
            }));
          }
        }
      }

    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Millis AI disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server ready for Millis AI connections`);
});

module.exports = app;