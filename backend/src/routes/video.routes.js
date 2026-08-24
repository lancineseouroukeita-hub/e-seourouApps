const express = require('express');
const {
  listVideos, listMyVideos, createVideo, deleteVideo, likeVideo, unlikeVideo,
  saveVideo, unsaveVideo, listComments, createComment,
} = require('../controllers/video.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listVideos));
router.get('/mine', requireAuth, asyncHandler(listMyVideos));
router.post('/', requireAuth, asyncHandler(createVideo));
router.delete('/:id', requireAuth, asyncHandler(deleteVideo));
router.post('/:id/like', requireAuth, asyncHandler(likeVideo));
router.post('/:id/unlike', requireAuth, asyncHandler(unlikeVideo));
router.post('/:id/save', requireAuth, asyncHandler(saveVideo));
router.post('/:id/unsave', requireAuth, asyncHandler(unsaveVideo));
router.get('/:id/comments', requireAuth, asyncHandler(listComments));
router.post('/:id/comments', requireAuth, asyncHandler(createComment));

module.exports = router;
