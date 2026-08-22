const express = require('express');
const { listCalls, getIceServers } = require('../controllers/call.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listCalls));
router.get('/ice-servers', requireAuth, asyncHandler(getIceServers));

module.exports = router;
