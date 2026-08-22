// Contrôle parental (Paramètres → Contrôle parental) : un compte "parent"
// peut superviser un ou plusieurs comptes "enfant" et restreindre qui peut
// les ajouter à des groupes (voir restrictGroupAdd, schema.prisma). La
// liaison se fait via un code à 6 chiffres généré par le parent, saisi par
// l'enfant — pas de scan QR/NFC, plus simple à faire fonctionner à distance
// (le parent peut envoyer le code par SMS/message classique).
//
// Portée volontairement limitée pour une première version : seule la
// restriction "qui peut m'ajouter à un groupe" est appliquée (voir
// conversation.controller.js, createConversation). D'autres restrictions
// (appels, statuts...) pourront s'ajouter plus tard sur le même modèle.
const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');

const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes, comme les codes OTP (utils/otp.js)
const RESTRICT_VALUES = ['everyone', 'contacts', 'noone'];

function toPublicChild(user) {
  return Object.assign(toPublicUser(user), { restrictGroupAdd: user.restrictGroupAdd });
}

function generateCode() {
  // Toujours 6 chiffres, y compris avec des zéros de tête.
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

// Génère un code de liaison à usage unique (valable 10 minutes) : l'appelant
// devient le "parent", l'autre compte (qui saisira ce code) deviendra l'"enfant".
async function generateLinkCode(req, res) {
  // Invalide les codes précédents non utilisés pour ne pas en accumuler.
  await prisma.parentLinkCode.updateMany({
    where: { parentId: req.user.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  let code = null;
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = generateCode();
    const existing = await prisma.parentLinkCode.findUnique({ where: { code: candidate } });
    if (!existing) code = candidate;
  }
  if (!code) return res.status(500).json({ error: 'Impossible de générer un code pour le moment, réessayez.' });

  await prisma.parentLinkCode.create({
    data: { code, parentId: req.user.id, expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS) },
  });

  return res.json({ code, expiresInSeconds: LINK_CODE_TTL_MS / 1000 });
}

// L'utilisateur courant (l'enfant) saisit un code généré par le parent pour
// se faire superviser par lui. Remplace un superviseur existant s'il y en avait déjà un.
async function linkToParent(req, res) {
  const code = String(req.body.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Code requis.' });

  const linkCode = await prisma.parentLinkCode.findUnique({ where: { code } });
  if (!linkCode || linkCode.consumedAt || linkCode.expiresAt < new Date()) {
    return res.status(400).json({ error: 'Code invalide ou expiré.' });
  }
  if (linkCode.parentId === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas lier votre propre compte à lui-même.' });
  }

  await prisma.$transaction([
    prisma.parentLinkCode.update({ where: { id: linkCode.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({ where: { id: req.user.id }, data: { supervisorId: linkCode.parentId } }),
  ]);

  const parent = await prisma.user.findUnique({ where: { id: linkCode.parentId } });
  return res.json({ supervisor: parent ? toPublicUser(parent) : null });
}

// Vue d'ensemble pour l'utilisateur courant : qui le supervise (s'il est un
// enfant) et les comptes qu'il supervise lui-même (s'il est parent).
async function getMyParentalStatus(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      supervisor: true,
      supervisedUsers: { orderBy: { name: 'asc' } },
    },
  });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  return res.json({
    supervisor: user.supervisor ? toPublicUser(user.supervisor) : null,
    supervisedUsers: user.supervisedUsers.map(toPublicChild),
  });
}

// Le parent modifie la restriction "ajout à un groupe" d'un enfant qu'il supervise.
async function updateChildRestrictions(req, res) {
  const { childId } = req.params;
  const { restrictGroupAdd } = req.body;
  if (!RESTRICT_VALUES.includes(restrictGroupAdd)) {
    return res.status(400).json({ error: 'Valeur invalide pour restrictGroupAdd.' });
  }

  const child = await prisma.user.findUnique({ where: { id: childId } });
  if (!child || child.supervisorId !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne supervisez pas ce compte.' });
  }

  const updated = await prisma.user.update({ where: { id: childId }, data: { restrictGroupAdd } });
  return res.json({ user: toPublicChild(updated) });
}

// Délie un compte de son superviseur : sans childId dans le corps, l'enfant se
// délie lui-même ; avec childId, un parent délie l'un des comptes qu'il
// supervise. Les deux côtés peuvent donc mettre fin à la supervision. Remet
// aussi restrictGroupAdd à "everyone" : sans superviseur, plus personne ne
// peut faire évoluer une restriction plus stricte.
async function unlink(req, res) {
  const { childId } = req.body || {};
  const targetId = childId || req.user.id;

  if (childId) {
    const child = await prisma.user.findUnique({ where: { id: childId } });
    if (!child || child.supervisorId !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne supervisez pas ce compte.' });
    }
  }

  await prisma.user.update({ where: { id: targetId }, data: { supervisorId: null, restrictGroupAdd: 'everyone' } });
  return res.json({ ok: true });
}

module.exports = { generateLinkCode, linkToParent, getMyParentalStatus, updateChildRestrictions, unlink };
