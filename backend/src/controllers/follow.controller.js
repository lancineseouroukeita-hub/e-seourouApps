const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');
const { awardCredits } = require('./wallet.controller');
const { CREDITS_PER_FOLLOWER_GAINED } = require('../utils/limits');

// Abonnements "Clips" (onglet "Ami(e)s" de Diarala_Tiktak) : comme TikTok,
// suivre quelqu'un est immédiat, sans demande à accepter (contrairement à une
// demande d'ami Facebook) — voir schema.prisma, modèle Follow.

// POST /api/follows/:userId
async function followUser(req, res) {
  try {
    const { userId } = req.params;
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous suivre vous-même.' });
    }
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    // Vérifié AVANT le upsert (pas juste "update: {}") pour savoir si cet
    // abonnement est vraiment nouveau — sinon se désabonner/se réabonner en
    // boucle permettrait de gagner des crédits "Solde" à l'infini (voir
    // limits.js, CREDITS_PER_FOLLOWER_GAINED).
    const alreadyFollowing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: req.user.id, followingId: userId } },
    });
    if (!alreadyFollowing) {
      await prisma.follow.create({ data: { followerId: req.user.id, followingId: userId } });
      await awardCredits(userId, CREDITS_PER_FOLLOWER_GAINED, 'abonne_gagne');
    }
    const followersCount = await prisma.follow.count({ where: { followingId: userId } });
    return res.json({ ok: true, followersCount });
  } catch (err) {
    console.error('followUser error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du suivi.' });
  }
}

// DELETE /api/follows/:userId
async function unfollowUser(req, res) {
  try {
    const { userId } = req.params;
    await prisma.follow.deleteMany({ where: { followerId: req.user.id, followingId: userId } });
    const followersCount = await prisma.follow.count({ where: { followingId: userId } });
    return res.json({ ok: true, followersCount });
  } catch (err) {
    console.error('unfollowUser error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du retrait du suivi.' });
  }
}

// GET /api/follows/summary — tout ce dont l'écran "Ami(e)s" a besoin en un
// seul appel : la liste des autres utilisateurs (comme listUsers de
// user.controller.js) avec, pour chacun, si je le suis déjà et son nombre
// d'abonnés, plus mes propres compteurs abonnés/abonnements (pour l'écran
// Profil). Volontairement pas de pagination pour cette première version.
async function listFollowSummary(req, res) {
  try {
    const [users, myFollowing, myFollowersCount, followerCounts] = await Promise.all([
      prisma.user.findMany({ where: { id: { not: req.user.id } }, orderBy: { name: 'asc' } }),
      prisma.follow.findMany({ where: { followerId: req.user.id }, select: { followingId: true } }),
      prisma.follow.count({ where: { followingId: req.user.id } }),
      prisma.follow.groupBy({ by: ['followingId'], _count: { followingId: true } }),
    ]);
    const followingSet = new Set(myFollowing.map((f) => f.followingId));
    const countMap = new Map(followerCounts.map((f) => [f.followingId, f._count.followingId]));
    return res.json({
      users: users.map((u) => Object.assign(toPublicUser(u), {
        following: followingSet.has(u.id),
        followersCount: countMap.get(u.id) || 0,
      })),
      myFollowingCount: myFollowing.length,
      myFollowersCount,
    });
  } catch (err) {
    console.error('listFollowSummary error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { followUser, unfollowUser, listFollowSummary };
