const express = require('express');
const router = express.Router();

// Placeholder i18n functionality
router.get('/', (req, res) => {
  res.json({ 
    message: 'Internationalization functionality placeholder',
    note: 'Full i18n implementation will be added here'
  });
});

module.exports = router;
