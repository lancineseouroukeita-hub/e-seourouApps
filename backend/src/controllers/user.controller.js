const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');

// Taille max de la photo de profil stockée (data URL base64 complète, préfixe
// "data:image/...;base64," inclus). Elle est redimensionnée et compressée côté
// client (canvas) avant l'envoi, donc en pratique très en dessous de cette limite.
const MAX_AVATAR_DATA_URL_LENGTH = 2 * 1024 * 1024;

// Liste tous les utilisateurs (sauf soi-même) pour permettre de démarrer une conversation/appel.
// Pour une vraie app, on ajouterait une pagination + une recherche par nom/téléphone.
async function listUsers(req, res) {
  const users = await prisma.user.findMany({
    where: { id: { not: req.user.id } },
    orderBy: { name: 'asc' },
  });
  return res.json({ users: users.map(toPublicUser) });
}

// Met à jour la photo de profil de l'utilisateur connecté. La photo est reçue
// déjà encodée en base64 (data URL complète) : pas de service de stockage
// externe, elle est stockée directement dans la colonne "avatarUrl" de Neon.
async function updateMyAvatar(req, res) {
  try {
    const { avatarUrl } = req.body;
    if (!avatarUrl || typeof avatarUrl !== 'string') {
      return res.status(400).json({ error: 'avatarUrl est requis.' });
    }
    if (!avatarUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Format de photo invalide.' });
    }
    if (avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
      return res.status(400).json({ error: 'Photo trop volumineuse.' });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
    });
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('updateMyAvatar error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la mise à jour de la photo.' });
  }
}

module.exports = { listUsers, updateMyAvatar };
