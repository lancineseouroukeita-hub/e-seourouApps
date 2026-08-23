const express = require('express');
const { listContacts, importContacts, addContact, removeContact } = require('../controllers/contact.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listContacts));
router.post('/import', requireAuth, asyncHandler(importContacts));
router.post('/', requireAuth, asyncHandler(addContact));
router.delete('/:id', requireAuth, asyncHandler(removeContact));

module.exports = router;
