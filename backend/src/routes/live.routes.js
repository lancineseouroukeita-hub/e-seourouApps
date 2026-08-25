const express = require('express');
const { listLiveSessions } = require('../controllers/live.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listLiveSessions));

module.exports = router;
