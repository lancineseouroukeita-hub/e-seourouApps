const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');

// Retire les espaces/tirets pour que "+224 621 00 00 00" et "+224-621-00-00-00"
// soient reconnus comme le même numéro à l'inscription comme à la connexion.
function normalizePhone(raw) {
  return String(raw || '').trim().replace(/[\s-]/g, '');
}

// Numéro international ou local, chiffres uniquement (+ optionnel en tête).
const PHONE_REGEX = /^\+?[0-9]{6,15}$/;

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    // Dernière fois qu'il avait au moins un appareil connecté (voir
    // utils/presence.js) : le champ "online" calculé séparément (voir
    // user.controller.js listUsers) prévaut côté client quand il est présent.
    lastSeenAt: user.lastSeenAt || null,
    // Vue par le propriétaire du compte lui-même (ex: écran Paramètres) : la
    // vraie valeur. Les autres utilisateurs ne la voient jamais (voir
    // user.controller.js / conversation.controller.js, qui la masquent).
    hideLastSeen: Boolean(user.hideLastSeen),
  };
}

async function register(req, res) {
  try {
    const { name } = req.body;
    const phone = normalizePhone(req.body.phone);
    const { password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'name, phone et password sont requis.' });
    }
    if (!PHONE_REGEX.test(phone)) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec ce numéro de téléphone.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, phone, password: hashed },
    });

    const token = signToken({ id: user.id, phone: user.phone, name: user.name });
    return res.status(201).json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'inscription.' });
  }
}

async function login(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    const { password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'phone et password sont requis.' });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(401).json({ error: 'Numéro de téléphone ou mot de passe incorrect.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Numéro de téléphone ou mot de passe incorrect.' });
    }

    const token = signToken({ id: user.id, phone: user.phone, name: user.name });
    return res.json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
}

async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  return res.json({ user: toPublicUser(user) });
}

module.exports = { register, login, me, toPublicUser };
