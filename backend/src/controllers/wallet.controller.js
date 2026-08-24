const prisma = require('../config/prisma');

// "Solde" (menu ☰ de Diarala_Tiktak) : des crédits INTERNES à l'application,
// pas de l'argent réel — voir schema.prisma, User.creditsBalance et modèle
// CreditTransaction. Aucun vrai paiement/virement n'est géré ici (ça
// demanderait un prestataire de paiement, une immatriculation, etc., bien
// au-delà de ce produit de test) : c'est une monnaie de jeu qui se gagne en
// étant aimé/suivi et se dépense pour "Promouvoir" une publication.

// Libellés affichés côté client pour chaque "reason" technique stockée en
// base (voir schema.prisma, CreditTransaction.reason) — centralisés ici pour
// rester cohérents même si la clé technique ne change jamais.
const REASON_LABELS = {
  like_recu: 'Un like reçu sur une publication',
  abonne_gagne: 'Un nouvel abonné',
  boost_video: 'Publication mise en avant ("Promouvoir")',
  bonus_bienvenue: 'Bonus de bienvenue',
};

// Enregistre un mouvement de crédits ET met à jour le total dénormalisé
// (User.creditsBalance) dans la même transaction — pour ne jamais les
// laisser désynchronisés si l'un des deux réussissait sans l'autre.
async function awardCredits(userId, amount, reason, relatedVideoId = null) {
  await prisma.$transaction([
    prisma.creditTransaction.create({ data: { userId, amount, reason, relatedVideoId } }),
    prisma.user.update({ where: { id: userId }, data: { creditsBalance: { increment: amount } } }),
  ]);
}

// GET /api/wallet — solde actuel + historique des mouvements (le plus
// récent en premier), pour l'écran "Solde" (menu ☰).
async function getWallet(req, res) {
  try {
    const [user, transactions] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.id }, select: { creditsBalance: true } }),
      prisma.creditTransaction.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return res.json({
      balance: user ? user.creditsBalance : 0,
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        reason: t.reason,
        label: REASON_LABELS[t.reason] || t.reason,
        relatedVideoId: t.relatedVideoId,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    console.error('getWallet error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { awardCredits, getWallet, REASON_LABELS };
