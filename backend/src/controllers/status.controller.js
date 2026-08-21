const prisma = require('../config/prisma');
const { isBlockedBetween } = require('../utils/blocking');
const { MAX_ATTACHMENT_BYTES } = require('../utils/limits'); // même limite que les pièces jointes du chat

const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24h, comme les Statuts WhatsApp

// Liste tous les statuts actifs (non expirés), les miens en premier (avec le
// nombre de vues), puis ceux des autres utilisateurs (en excluant les
// personnes bloquées dans un sens ou dans l'autre), regroupés par auteur.
async function listStatuses(req, res) {
  const userId = req.user.id;
  try {
    const now = new Date();
    const statuses = await prisma.status.findMany({
      where: { expiresAt: { gt: now } },
      include: {
        user: true,
        views: { select: { viewerId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Filtre les statuts des personnes bloquées (dans un sens ou dans l'autre).
    const visible = [];
    for (const s of statuses) {
      if (s.userId === userId) { visible.push(s); continue; }
      const blocked = await isBlockedBetween(userId, s.userId);
      if (!blocked) visible.push(s);
    }

    const byUser = new Map();
    for (const s of visible) {
      if (!byUser.has(s.userId)) byUser.set(s.userId, []);
      byUser.get(s.userId).push(s);
    }

    const result = [];
    for (const [uid, list] of byUser.entries()) {
      const author = list[0].user;
      const items = list.map((s) => ({
        id: s.id,
        type: s.type,
        content: s.content,
        backgroundColor: s.backgroundColor,
        attachmentData: s.attachmentData,
        attachmentMime: s.attachmentMime,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        viewCount: s.views.length,
        viewedByMe: s.views.some((v) => v.viewerId === userId),
      }));
      result.push({
        userId: uid,
        name: author.name,
        avatarUrl: author.avatarUrl,
        isMine: uid === userId,
        statuses: items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
        allViewed: items.every((it) => it.viewedByMe),
      });
    }

    // Mes statuts en premier, puis les autres, du plus récent au plus ancien.
    result.sort((a, b) => {
      if (a.isMine) return -1;
      if (b.isMine) return 1;
      const aLatest = new Date(a.statuses[a.statuses.length - 1].createdAt);
      const bLatest = new Date(b.statuses[b.statuses.length - 1].createdAt);
      return bLatest - aLatest;
    });

    return res.json({ statuses: result });
  } catch (err) {
    console.error('listStatuses error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du chargement des statuts.' });
  }
}

// Crée un nouveau statut (texte coloré ou photo), valable 24h.
async function createStatus(req, res) {
  const userId = req.user.id;
  const { type, content, backgroundColor, attachmentData, attachmentMime } = req.body || {};

  if (type !== 'text' && type !== 'photo') {
    return res.status(400).json({ error: 'Type de statut invalide.' });
  }
  if (type === 'text' && (!content || !content.trim())) {
    return res.status(400).json({ error: 'Le texte du statut ne peut pas être vide.' });
  }
  if (type === 'photo') {
    if (!attachmentData) return res.status(400).json({ error: 'Photo manquante.' });
    const approxBytes = Math.ceil((attachmentData.length * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: 'Photo trop volumineuse (5 Mo maximum).' });
    }
  }

  try {
    const now = new Date();
    const status = await prisma.status.create({
      data: {
        userId,
        type,
        content: content ? String(content).slice(0, 500) : null,
        backgroundColor: type === 'text' ? (backgroundColor || '#25d366') : null,
        attachmentData: type === 'photo' ? attachmentData : null,
        attachmentMime: type === 'photo' ? (attachmentMime || 'image/jpeg') : null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + STATUS_LIFETIME_MS),
      },
    });
    return res.status(201).json({ status });
  } catch (err) {
    console.error('createStatus error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la publication du statut.' });
  }
}

// Marque un statut comme vu par l'utilisateur courant (idempotent).
async function viewStatus(req, res) {
  const userId = req.user.id;
  const { statusId } = req.params;
  try {
    const status = await prisma.status.findUnique({ where: { id: statusId } });
    if (!status) return res.status(404).json({ error: 'Statut introuvable.' });
    if (status.userId === userId) return res.json({ ok: true }); // pas besoin de "voir" son propre statut
    await prisma.statusView.upsert({
      where: { statusId_viewerId: { statusId, viewerId: userId } },
      update: {},
      create: { statusId, viewerId: userId },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('viewStatus error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// Supprime un de mes statuts avant son expiration naturelle.
async function deleteStatus(req, res) {
  const userId = req.user.id;
  const { statusId } = req.params;
  try {
    const status = await prisma.status.findUnique({ where: { id: statusId } });
    if (!status) return res.status(404).json({ error: 'Statut introuvable.' });
    if (status.userId !== userId) return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres statuts.' });
    await prisma.status.delete({ where: { id: statusId } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('deleteStatus error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression du statut.' });
  }
}

module.exports = { listStatuses, createStatus, viewStatus, deleteStatus };
