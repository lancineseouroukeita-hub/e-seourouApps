const express = require('express');
const { listUsers, deleteUser } = require('../controllers/admin.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { authRateLimit } = require('../utils/rateLimit');

const router = express.Router();

// requireAdmin après requireAuth partout ici : voir middleware/auth.js.
router.get('/users', requireAuth, requireAdmin, asyncHandler(listUsers));
// authRateLimit en plus sur la suppression : action destructrice, même
// logique que pour /api/auth/register et /login.
router.delete('/users/:userId', requireAuth, requireAdmin, authRateLimit, asyncHandler(deleteUser));

module.exports = router;
