const express = require('express');
const mongoose = require('mongoose');
const { getCacheStats } = require('../services/clinicServices');

const router = express.Router();

router.get('/', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    server_time: new Date().toISOString(),
    database: {
      state: dbStates[mongoose.connection.readyState] || 'unknown',
      name: mongoose.connection.name || null,
    },
    cache: getCacheStats(),
    uptime_seconds: process.uptime(),
  });
});

module.exports = router;