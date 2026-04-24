# Custom LLM Backend

A Node.js backend with WebSocket support for Millis AI custom LLM integration using Google Gemini API.

## Features

- Express.js server with CORS support
- WebSocket server for Millis AI integration
- Google Gemini API integration for LLM responses
- Environment configuration
- Basic health check endpoint

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Add your Gemini API key to `.env`:
   ```
   GEMINI_API_KEY=your_actual_gemini_api_key
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Or start the production server:
   ```bash
   npm start
   ```

## Millis AI Integration

### WebSocket Endpoint
The server provides a WebSocket endpoint that Millis AI connects to for custom LLM processing.

### Configuration in Millis AI
1. Go to [Millis AI Playground](https://app.millis.ai/agents)
2. Create or edit your voice agent
3. In the agent settings, set the **Custom LLM WebSocket URL** to:
   ```
   ws://your-server-domain:3000
   ```
   (Replace `your-server-domain` with your actual domain/IP)

4. Configure your agent with:
   - Prompt instructions
   - Voice settings
   - Other preferences

### API Endpoints

- `GET /` - Welcome message
- `GET /api/health` - Health check
- `WebSocket /` - Millis AI connection endpoint

## Environment Variables

- `PORT` - Server port (default: 3000)
- `GEMINI_API_KEY` - Your Google Gemini API key
- `NODE_ENV` - Environment (development/production)

## Development

- Use `npm run dev` for development with auto-restart
- Add new routes in `src/routes/`
- WebSocket messages are logged to console

## Project Structure

```
src/
├── app.js          # Main application with WebSocket server
└── routes/
    └── health.js   # Health check route
```

## Testing

You can test the WebSocket connection using tools like [WebSocket King](https://websocketking.com/) or implement the Millis AI Web SDK in your frontend.

## Support

For Millis AI documentation: https://docs.millis.ai
For Gemini API: https://ai.google.dev/docs

- Use `npm run dev` for development with auto-restart
- Add new routes in `src/routes/`
- Configure environment variables in `.env`