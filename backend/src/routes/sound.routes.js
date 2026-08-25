const express = require('express');
const {
  listSounds, getSound, createSound, deleteSound, searchOnlineMusic, fetchOnlinePreview,
} = require('../controllers/sound.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Chemins fixes déclarés AVANT "/:id" (même règle que video.routes.js) :
// sinon Express prendrait "search-online" pour un :id et route vers getSound.
router.get('/search-online', requireAuth, asyncHandler(searchOnlineMusic));
router.post('/online-preview', requireAuth, asyncHandler(fetchOnlinePreview));

router.get('/', requireAuth, asyncHandler(listSounds));
router.get('/:id', requireAuth, asyncHandler(getSound));
// Ajout/suppression réservés à un administrateur (voir requireAdmin) : la
// bibliothèque partagée de sons n'est pas alimentable par n'importe quel
// utilisateur, pour des raisons de droits d'auteur (voir sound.controller.js).
router.post('/', requireAuth, requireAdmin, asyncHandler(createSound));
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(deleteSound));

module.exports = router;
