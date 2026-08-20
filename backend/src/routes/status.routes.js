const express = require('express');
const { listStatuses, createStatus, viewStatus, deleteStatus } = require('../controllers/status.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listStatuses);
router.post('/', requireAuth, createStatus);
router.post('/:statusId/view', requireAuth, viewStatus);
router.delete('/:statusId', requireAuth, deleteStatus);

module.exports = router;
