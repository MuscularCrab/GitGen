const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import modular components
const { router: authRoutes } = require('./modules/auth/auth');
const searchRoutes = require('./modules/features/search');
const templateRoutes = require('./modules/features/templates');
const webhookRoutes = require('./modules/features/webhooks');
const exportRoutes = require('./modules/features/export');
const i18nRoutes = require('./modules/features/i18n');
const analyticsRoutes = require('./modules/analytics/analytics');
const qualityRoutes = require('./modules/analytics/quality');
const dependencyRoutes = require('./modules/analytics/dependencies');
const architectureRoutes = require('./modules/analytics/architecture');
const apiDocRoutes = require('./modules/analytics/api-docs');
const schemaRoutes = require('./modules/analytics/schema');
const deploymentRoutes = require('./modules/analytics/deployment');
const pluginRoutes = require('./modules/plugins/plugin-system');
const websocketHandler = require('./modules/utils/websocket');
const cacheHandler = require('./modules/utils/cache');
const batchHandler = require('./modules/utils/batch-processing');

const app = express();
const PORT = process.env.PORT || 3030;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/build')));

// Mount modular routes
app.use('/api/auth', authRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/i18n', i18nRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/analytics/code-quality', qualityRoutes);
app.use('/api/analytics/dependencies', dependencyRoutes);
app.use('/api/analytics/architecture', architectureRoutes);
app.use('/api/analytics/api-docs', apiDocRoutes);
app.use('/api/analytics/schema', schemaRoutes);
app.use('/api/analytics/deployment', deploymentRoutes);
app.use('/api/plugins', pluginRoutes);

// Initialize core systems
websocketHandler.initialize(app);
cacheHandler.initialize();
batchHandler.initialize();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    version: '2.0.0'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 GitGen server running on port ${PORT}`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`🔐 Authentication endpoints: /api/auth/*`);
  console.log(`👥 Team management: /api/teams/*`);
  console.log(`👤 User projects: /api/user/projects`);
  console.log(`🔍 Search: /api/search/*`);
  console.log(`📝 Templates: /api/templates/*`);
  console.log(`📊 Analytics: /api/analytics/*`);
  console.log(`🔌 WebSocket: Real-time updates enabled`);
});
