const prisma = require('../config/prisma');

// "Solde" (menu ☰ de Diarala_Tiktak) : des credits qui se gagnent en etant
// aime/suivi, se depensent pour "Promouvoir" une publication (voir
// schema.prisma, User.creditsBalance et modele CreditTransaction) -- et,
// depuis l'ajout de creditPurchase.controller.js, peuvent AUSSI s'acheter
// avec du vrai argent (mobile money, via CinetPay) : voir
// creditPurchase.controller.js pour cette partie-la.

// Libelles affiches cote client pour chaque "reason" technique stockee en
// base (voir schema.prisma, CreditTransaction.reason) — centralises ici pour
// rester coherents meme si la cle technique ne change jamais.
const REASON_LABELS = {
  like_recu: 'Un like reçu sur une publication',
  abonne_gagne: 'Un nouvel abonné',
  boost_video: 'Publication mise en avant ("Promouvoir")',
  bonus_bienvenue: 'Bonus de bienvenue',
  achat_credits: 'Crédits achetés',
};

// Enregistre un mouvement de credits ET met a jour le total denormalise
// (User.creditsBalance) dans la meme transaction — pour ne jamais les
// laisser desynchronises si l'un des deux reussissait sans l'autre.
async function awardCredits(userId, amount, reason, relatedVideoId = null) {
  await prisma.$transaction([
    prisma.creditTransaction.create({ data: { userId, amount, reason, relatedVideoId } }),
    prisma.user.update({ where: { id: userId }, data: { creditsBalance: { increment: amount } } }),
  ]);
}

// GET /api/wallet — solde actuel + historique des mouvements (le plus
// recent en premier), pour l'ecran "Solde" (menu ☰).
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