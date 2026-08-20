const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');

// Taille max de la photo de profil stockée (data URL base64 complète, préfixe
// "data:image/...;base64," inclus). Elle est redimensionnée et compressée côté
// client (canvas) avant l'envoi, donc en pratique très en dessous de cette limite.
const MAX_AVATAR_DATA_URL_LENGTH = 2 * 1024 * 1024;

// Liste tous les utilisateurs (sauf soi-même) pour permettre de démarrer une conversation/appel.
// Pour une vraie app, on ajouterait une pagination + une recherche par nom/téléphone.
async function listUsers(req, res) {
  const [users, blocked] = await Promise.all([
    prisma.user.findMany({
      where: { id: { not: req.user.id } },
      orderBy: { name: 'asc' },
    }),
    prisma.blockedUser.findMany({ where: { blockerId: req.user.id }, select: { blockedId: true } }),
  ]);
  const blockedIds = new Set(blocked.map((b) => b.blockedId));
  return res.json({ users: users.map((u) => Object.assign(toPublicUser(u), { blocked: blockedIds.has(u.id) })) });
}

// Liste des utilisateurs que j'ai bloqués (Paramètres → Confidentialité).
async function listBlockedUsers(req, res) {
  const blocked = await prisma.blockedUser.findMany({
    where: { blockerId: req.user.id },
    include: { blocked: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ users: blocked.map((b) => toPublicUser(b.blocked)) });
}

// Bloque un utilisateur : il ne pourra plus m'envoyer de message ni m'appeler
// (vérifié côté socket dans message:send et call:join), tant que je ne l'ai
// pas débloqué. Le blocage n'est pas réciproque : lui continue de me voir
// normalement de son côté, sauf que ses messages/appels vers moi seront rejetés.
async function blockUser(req, res) {
  try {
    const { userId } = req.params;
    if (userId === req.user.id) return res.status(400).json({ error: 'Impossible de vous bloquer vous-même.' });

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    await prisma.blockedUser.upsert({
      where: { blockerId_blockedId: { blockerId: req.user.id, blockedId: userId } },
      update: {},
      create: { blockerId: req.user.id, blockedId: userId },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('blockUser error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du blocage.' });
  }
}

// Débloque un utilisateur précédemment bloqué.
async function unblockUser(req, res) {
  try {
    const { userId } = req.params;
    await prisma.blockedUser.deleteMany({ where: { blockerId: req.user.id, blockedId: userId } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('unblockUser error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du déblocage.' });
  }
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

// Met à jour le nom affiché de l'utilisateur connecté (onglet Paramètres).
async function updateMyName(req, res) {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Le nom ne peut pas être vide.' });
    if (name.length > 80) return res.status(400).json({ error: 'Nom trop long (80 caractères maximum).' });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name },
    });
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('updateMyName error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la mise à jour du nom.' });
  }
}

// Change le mot de passe de l'utilisateur connecté : vérifie l'ancien avant
// d'enregistrer le nouveau, comme n'importe quel changement de mot de passe.
async function updateMyPassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('updateMyPassword error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du changement de mot de passe.' });
  }
}

module.exports = {
  listUsers,
  updateMyAvatar,
  updateMyName,
  updateMyPassword,
  listBlockedUsers,
  blockUser,
  unblockUser,
};

