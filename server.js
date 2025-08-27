const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3030;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client/build (React app)
app.use(express.static(path.join(__dirname, 'client/build')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    version: '2.0.0'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'GitGen API',
    version: '2.0.0',
    description: 'AI-powered repository analysis and documentation generation',
    endpoints: {
      health: '/api/health',
      info: '/api'
    }
  });
});

// Root route - serve the React app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Catch-all route for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 GitGen server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌐 Web interface: http://localhost:${PORT}`);
  console.log(`📖 API info: http://localhost:${PORT}/api`);
});
