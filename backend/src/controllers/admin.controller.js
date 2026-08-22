const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');

// Liste tous les utilisateurs (Paramètres → Administration), avec recherche
// facultative par nom ou numéro. Réservé aux administrateurs (voir
// middleware/auth.js requireAdmin) — pas d'informations sensibles
// supplémentaires par rapport à ce que /api/users renvoie déjà (toPublicUser
// ne contient jamais le hash du mot de passe).
async function listUsers(req, res) {
  const q = String(req.query.q || '').trim();
  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200, // large marge pour une app qui débute ; à paginer si la base grossit vraiment
  });
  return res.json({ users: users.map(toPublicUser) });
}

// Supprime définitivement le compte d'un AUTRE utilisateur (modération,
// compte abusif, etc.). Confirmé par le mot de passe de l'administrateur
// lui-même (pas celui de la cible, qu'on ne connaît pas) : même principe que
// deleteMyAccount, adapté au fait qu'ici la personne qui confirme n'est pas
// la personne supprimée. Cascade en base identique (schema.prisma).
async function deleteUser(req, res) {
  try {
    const { userId } = req.params;
    const { password } = req.body;

    if (!password) return res.status(400).json({ error: 'Mot de passe requis pour confirmer la suppression.' });
    if (userId === req.user.id) {
      return res.status(400).json({
        error: 'Utilisez "Supprimer mon compte" dans vos propres Paramètres pour supprimer votre compte.',
      });
    }

    const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!admin) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'Cet utilisateur n\'existe plus.' });

    await prisma.user.delete({ where: { id: userId } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('admin deleteUser error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression de l\'utilisateur.' });
  }
}

module.exports = { listUsers, deleteUser };
