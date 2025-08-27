const express = require('express');
const router = express.Router();

// Placeholder plugin system functionality
router.get('/', (req, res) => {
  res.json({ 
    message: 'Plugin system placeholder',
    note: 'Full plugin system implementation will be added here'
  });
});

module.exports = router;
