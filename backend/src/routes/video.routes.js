const express = require('express');
const {
  listVideos, listMyVideos, listSavedVideos, listLikedVideos, createVideo, deleteVideo, likeVideo, unlikeVideo,
  saveVideo, unsaveVideo, listComments, createComment, reportVideo, shareVideo, getVideoMedia,
  recordView, boostVideo, getMyStats, updateVideoPrivacy, getVideoPrivacy,
} = require('../controllers/video.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Routes à chemin fixe déclarées AVANT "/:id" : Express les distingue déjà
// par leur forme (nombre de segments), mais les garder groupées ici évite
// toute ambiguïté visuelle en relisant ce fichier.
router.get('/', requireAuth, asyncHandler(listVideos));
router.get('/mine', requireAuth, asyncHandler(listMyVideos));
router.get('/saved', requireAuth, asyncHandler(listSavedVideos));
router.get('/liked', requireAuth, asyncHandler(listLikedVideos));
// "TikTok Studio" (menu ☰) — voir video.controller.js, getMyStats.
router.get('/stats/mine', requireAuth, asyncHandler(getMyStats));
// "Paramètres et confidentialité" (menu ☰) — compte "privé" pour Clips
// uniquement (voir schema.prisma, User.videosPrivate).
router.get('/settings/privacy', requireAuth, asyncHandler(getVideoPrivacy));
router.patch('/settings/privacy', requireAuth, asyncHandler(updateVideoPrivacy));

router.post('/', requireAuth, asyncHandler(createVideo));
router.delete('/:id', requireAuth, asyncHandler(deleteVideo));
router.post('/:id/like', requireAuth, asyncHandler(likeVideo));
router.post('/:id/unlike', requireAuth, asyncHandler(unlikeVideo));
router.post('/:id/save', requireAuth, asyncHandler(saveVideo));
router.post('/:id/unsave', requireAuth, asyncHandler(unsaveVideo));
router.get('/:id/comments', requireAuth, asyncHandler(listComments));
// Contenu binaire réel d'UNE vidéo, récupéré à la demande (voir
// video.controller.js, getVideoMedia et VIDEO_LIST_SELECT) — jamais renvoyé
// par les listings (fil, profil, enregistrées) pour rester rapides.
router.get('/:id/media', requireAuth, asyncHandler(getVideoMedia));
router.post('/:id/comments', requireAuth, asyncHandler(createComment));
// Vue comptée pour "TikTok Studio" (voir getMyStats) — une par visionnage,
// pas idempotent comme like/save (voir video.controller.js, recordView).
router.post('/:id/view', requireAuth, asyncHandler(recordView));
// "Promouvoir" (menu ☰) — dépense des crédits "Solde" (voir wallet.routes.js).
router.post('/:id/boost', requireAuth, asyncHandler(boostVideo));
// "Signaler" (menu d'appui long sur une publication) — voir video.controller.js, reportVideo.
router.post('/:id/report', requireAuth, asyncHandler(reportVideo));
// Icône flèche du fil (compteur de partages, comme TikTok) — voir video.controller.js, shareVideo.
router.post('/:id/share', requireAuth, asyncHandler(shareVideo));

module.exports = router;
