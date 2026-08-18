const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');

// Liste tous les utilisateurs (sauf soi-même) pour permettre de démarrer une conversation/appel.
// Pour une vraie app, on ajouterait une pagination + une recherche par nom/email.
async function listUsers(req, res) {
  const users = await prisma.user.findMany({
    where: { id: { not: req.user.id } },
    orderBy: { name: 'asc' },
  });
  return res.json({ users: users.map(toPublicUser) });
}

module.exports = { listUsers };
