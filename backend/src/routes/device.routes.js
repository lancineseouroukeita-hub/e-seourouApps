const express = require('express');
const { listDevices, logoutDevice, logoutOtherDevices, logoutSelf } = require('../controllers/device.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listDevices));
router.post('/logout-self', requireAuth, asyncHandler(logoutSelf));
router.post('/logout-others', requireAuth, asyncHandler(logoutOtherDevices));
router.post('/:id/logout', requireAuth, asyncHandler(logoutDevice));

module.exports = router;
