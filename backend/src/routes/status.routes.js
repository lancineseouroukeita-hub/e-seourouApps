const express = require('express');
const { listStatuses, createStatus, viewStatus, deleteStatus } = require('../controllers/status.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listStatuses));
router.post('/', requireAuth, asyncHandler(createStatus));
router.post('/:statusId/view', requireAuth, asyncHandler(viewStatus));
router.delete('/:statusId', requireAuth, asyncHandler(deleteStatus));

module.exports = router;
