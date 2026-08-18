const express = require('express');
const { listUsers } = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listUsers);

module.exports = router;
