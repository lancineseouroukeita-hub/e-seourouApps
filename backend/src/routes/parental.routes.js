const express = require('express');
const {
  generateLinkCode,
  linkToParent,
  getMyParentalStatus,
  updateChildRestrictions,
  unlink,
} = require('../controllers/parental.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/me', requireAuth, asyncHandler(getMyParentalStatus));
router.post('/generate-code', requireAuth, asyncHandler(generateLinkCode));
router.post('/link', requireAuth, asyncHandler(linkToParent));
router.patch('/child/:childId/restrictions', requireAuth, asyncHandler(updateChildRestrictions));
router.post('/unlink', requireAuth, asyncHandler(unlink));

module.exports = router;
