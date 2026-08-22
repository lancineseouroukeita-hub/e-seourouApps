const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');

// Retire les espaces/tirets/parenthèses/points pour que "+224 621 00 00 00",
// "+224-621-00-00-00" et "+224 (621) 00.00.00" soient reconnus comme le même
// numéro à l'inscription comme à la connexion. Convertit aussi le préfixe
// international "00" en "+" (ex: "00224621000000" -> "+224621000000"), sinon
// ces deux écritures créeraient deux comptes distincts pour le même numéro.
function normalizePhone(raw) {
  let phone = String(raw || '').trim().replace(/[\s\-().]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  return phone;
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
