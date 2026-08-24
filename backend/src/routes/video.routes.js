const express = require('express');
const { listVideos, listMyVideos, createVideo, deleteVideo, likeVideo, unlikeVideo } = require('../controllers/video.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listVideos));
router.get('/mine', requireAuth, asyncHandler(listMyVideos));
router.post('/', requireAuth, asyncHandler(createVideo));
router.delete('/:id', requireAuth, asyncHandler(deleteVideo));
router.post('/:id/like', requireAuth, asyncHandler(likeVideo));
router.post('/:id/unlike', requireAuth, asyncHandler(unlikeVideo));

module.exports = router;
