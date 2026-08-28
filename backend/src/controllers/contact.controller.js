const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');
const { isOnline } = require('../utils/presence');
const { normalizePhone, PHONE_REGEX, extractDialCode } = require('../utils/phone');

// Limite raisonnable pour un import en une fois (répertoire de téléphone
// entier) : évite qu'une requête malformée n'essaie d'insérer des dizaines de
// milliers de lignes d'un coup.
const MAX_IMPORT_CONTACTS = 2000;

function serializeContact(c) {
  return { id: c.id, phone: c.phone, label: c.label || null, createdAt: c.createdAt };
}

// Enrichit une liste de contacts bruts (téléphone + libellé) avec le compte
// existant sur l'application qui correspond à ce numéro, s'il y en a un. La
// correspondance se fait à la LECTURE (on ne copie jamais le compte dans
// Contact) : si quelqu'un dont j'ai déjà le numéro enregistré s'inscrit plus
// tard sur l'appli, il apparaît automatiquement dans ma liste sans que j'aie
// besoin de réimporter mes contacts — exactement comme WhatsApp.
// Même logique de blocage/confidentialité "dernière connexion" que listUsers
// (user.controller.js), pour un comportement cohérent partout dans l'appli.
async function attachMatches(contacts, requesterId) {
  const phones = [...new Set(contacts.map((c) => c.phone))];
  if (!phones.length) return [];

  const [matchedUsers, blocked] = await Promise.all([
    prisma.user.findMany({ where: { phone: { in: phones }, id: { not: requesterId } } }),
    prisma.blockedUser.findMany({ where: { blockerId: requesterId }, select: { blockedId: true } }),
  ]);
  const blockedIds = new Set(blocked.map((b) => b.blockedId));
  const byPhone = new Map(matchedUsers.map((u) => [u.phone, u]));

  return contacts.map((c) => {
    const u = byPhone.get(c.phone);
    if (!u) return Object.assign(serializeContact(c), { matchedUser: null });
    const pub = toPublicUser(u);
    if (u.hideLastSeen) pub.lastSeenAt = null;
    Object.assign(pub, { blocked: blockedIds.has(u.id), online: u.hideLastSeen ? false : isOnline(u.id) });
    return Object.assign(serializeContact(c), { matchedUser: pub });
  });
}

// GET /api/contacts — mes contacts enregistrés (importés depuis le téléphone
// ou ajoutés à la main), avec le compte de l'application correspondant s'il
// existe. C'est CETTE liste (filtrée aux entrées avec matchedUser non nul
// côté client) qui doit alimenter "Nouvelle discussion" et la composition
// d'un groupe/communauté — jamais la liste de tous les comptes de l'appli :
// si je n'ai pas le numéro de quelqu'un dans mon téléphone, je ne dois pas le
// voir, même s'il utilise l'application.
async function listContacts(req, res) {
  const contacts = await prisma.contact.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ contacts: await attachMatches(contacts, req.user.id) });
}

// POST /api/contacts/import — import en masse depuis le répertoire du
// téléphone (Contact Picker de l'appareil, déclenché côté client). Chaque
// numéro est normalisé puis enregistré ; un numéro déjà connu est juste mis à
// jour (nouveau libellé éventuel) plutôt que dupliqué. Les numéros invalides
// ou correspondant à mon propre compte sont silencieusement ignorés (comme
// WhatsApp, qui ne se liste jamais lui-même parmi ses contacts).
async function importContacts(req, res) {
  try {
    const raw = Array.isArray(req.body.contacts) ? req.body.contacts : [];
    if (!raw.length) return res.status(400).json({ error: 'Aucun contact à importer.' });
    if (raw.length > MAX_IMPORT_CONTACTS) {
      return res.status(400).json({ error: `Trop de contacts en une fois (max ${MAX_IMPORT_CONTACTS}).` });
    }

    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    // Indicatif de MON compte (ex: "+224"), utilisé comme valeur par défaut
    // pour les numéros importés sans indicatif — voir normalizePhone().
    const myDial = me ? extractDialCode(me.phone) : null;

    const seen = new Set();
    const toUpsert = [];
    for (const entry of raw) {
      const rawPhones = Array.isArray(entry.phones) ? entry.phones : entry.phone ? [entry.phone] : [];
      const name = String(entry.name || '').trim().slice(0, 120) || null;
      for (const p of rawPhones) {
        const phone = normalizePhone(p, myDial);
        if (!phone || !PHONE_REGEX.test(phone)) continue;
        if (me && phone === me.phone) continue; // pas moi-même
        if (seen.has(phone)) continue;
        seen.add(phone);
        toUpsert.push({ phone, label: name });
      }
    }

    if (!toUpsert.length) {
      return res.status(400).json({ error: 'Aucun numéro de téléphone valide dans la sélection.' });
    }

    await prisma.$transaction(
      toUpsert.map((c) =>
        prisma.contact.upsert({
          where: { ownerId_phone: { ownerId: req.user.id, phone: c.phone } },
          update: c.label ? { label: c.label } : {},
          create: { ownerId: req.user.id, phone: c.phone, label: c.label },
        })
      )
    );

    const contacts = await prisma.contact.findMany({
      where: { ownerId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ contacts: await attachMatches(contacts, req.user.id), imported: toUpsert.length });
  } catch (err) {
    console.error('importContacts error:', err);
    return res.status(500).json({ error: "Erreur serveur lors de l'import des contacts." });
  }
}

// POST /api/contacts — ajoute un contact à la main en tapant son numéro (cas
// où je connais le numéro de quelqu'un sans l'avoir dans le répertoire de mon
// téléphone, ou pas d'accès au Contact Picker sur ce navigateur/appareil).
async function addContact(req, res) {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    const myDial = me ? extractDialCode(me.phone) : null;
    const phone = normalizePhone(req.body.phone, myDial);
    const name = String(req.body.name || '').trim().slice(0, 120) || null;
    if (!phone || !PHONE_REGEX.test(phone)) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    }

    if (me && phone === me.phone) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous ajouter vous-même.' });
    }

    const contact = await prisma.contact.upsert({
      where: { ownerId_phone: { ownerId: req.user.id, phone } },
      update: name ? { label: name } : {},
      create: { ownerId: req.user.id, phone, label: name },
    });

    const [enriched] = await attachMatches([contact], req.user.id);
    return res.status(201).json({ contact: enriched });
  } catch (err) {
    console.error('addContact error:', err);
    return res.status(500).json({ error: "Erreur serveur lors de l'ajout du contact." });
  }
}

// DELETE /api/contacts/:id — retire un contact de mon répertoire (ex: ajouté
// par erreur). N'affecte que ma propre liste, jamais celle des autres.
async function removeContact(req, res) {
  try {
    const { id } = req.params;
    await prisma.contact.deleteMany({ where: { id, ownerId: req.user.id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('removeContact error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression du contact.' });
  }
}

module.exports = { listContacts, importContacts, addContact, removeContact };
