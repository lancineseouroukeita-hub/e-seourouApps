const express = require('express');
const { listCalls } = require('../controllers/call.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listCalls));

module.exports = router;
