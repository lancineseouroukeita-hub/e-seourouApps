const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');
const { notifyConversationCreated } = require('./conversation.controller');

// Vérifie que l'utilisateur est membre d'une communauté, et renvoie son rôle
// ("admin" | "member") ou null s'il n'en fait pas partie.
async function myRole(communityId, userId) {
  const m = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });
  return m ? m.role : null;
}

function serializeCommunity(c, myRoleValue) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    createdAt: c.createdAt,
    myRole: myRoleValue,
    memberCount: c.members.length,
    members: c.members.map((m) => Object.assign({}, toPublicUser(m.user), { role: m.role })),
    groups: c.conversations.map((conv) => ({
      conversationId: conv.id,
      name: conv.name,
      isAnnouncement: conv.isAnnouncement,
    })),
  };
}

// Liste les communautés dont je suis membre.
async function listCommunities(req, res) {
  try {
    const memberships = await prisma.communityMember.findMany({ where: { userId: req.user.id } });
    const ids = memberships.map((m) => m.communityId);
    if (!ids.length) return res.json({ communities: [] });

    const communities = await prisma.community.findMany({
      where: { id: { in: ids } },
      include: {
        members: { include: { user: true } },
        conversations: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const roleByCommunity = new Map(memberships.map((m) => [m.communityId, m.role]));
    return res.json({ communities: communities.map((c) => serializeCommunity(c, roleByCommunity.get(c.id))) });
  } catch (err) {
    console.error('listCommunities error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du chargement des communautés.' });
  }
}

// Détail d'une communauté (seulement si j'en suis membre).
async function getCommunity(req, res) {
  const { communityId } = req.params;
  try {
    const role = await myRole(communityId, req.user.id);
    if (!role) return res.status(403).json({ error: 'Vous n\'êtes pas membre de cette communauté.' });
    const c = await prisma.community.findUnique({
      where: { id: communityId },
      include: { members: { include: { user: true } }, conversations: true },
    });
    if (!c) return res.status(404).json({ error: 'Communauté introuvable.' });
    return res.json({ community: serializeCommunity(c, role) });
  } catch (err) {
    console.error('getCommunity error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// Crée une communauté : je deviens admin, les membres choisis sont ajoutés,
// et un groupe d'annonces (écriture réservée aux admins) est créé automatiquement.
async function createCommunity(req, res) {
  const userId = req.user.id;
  const { name, description, memberUserIds } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom de la communauté est requis.' });

  const memberIds = Array.from(new Set((Array.isArray(memberUserIds) ? memberUserIds : []).filter((id) => id && id !== userId)));

  try {
    const community = await prisma.community.create({
      data: {
        name: name.trim(),
        description: description ? String(description).slice(0, 500) : null,
        creatorId: userId,
        members: {
          create: [
            { userId, role: 'admin' },
            ...memberIds.map((id) => ({ userId: id, role: 'member' })),
          ],
        },
        conversations: {
          create: {
            isGroup: true,
            isAnnouncement: true,
            name: name.trim(),
            participants: {
              create: [userId, ...memberIds].map((id) => ({ userId: id })),
            },
          },
        },
      },
      include: { members: { include: { user: true } }, conversations: true },
    });

    // Notifie les membres ajoutés (temps réel) que le groupe d'annonces de la
    // communauté vient d'apparaître dans leurs discussions — sans ça, il ne le
    // verrait qu'au prochain rechargement de l'application.
    const announcementConv = community.conversations.find((c) => c.isAnnouncement);
    if (announcementConv) {
      notifyConversationCreated(req, {
        id: announcementConv.id,
        isGroup: true,
        name: announcementConv.name,
        createdAt: announcementConv.createdAt,
        participants: community.members.map((m) => ({ userId: m.userId, user: m.user, lastReadAt: null })),
        messages: [],
      }, userId);
    }

    return res.status(201).json({ community: serializeCommunity(community, 'admin') });
  } catch (err) {
    console.error('createCommunity error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la création de la communauté.' });
  }
}

// Crée un nouveau groupe rattaché à une communauté existante (n'importe quel
// membre peut créer un groupe, comme sur WhatsApp).
async function createCommunityGroup(req, res) {
  const userId = req.user.id;
  const { communityId } = req.params;
  const { name, memberUserIds } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom du groupe est requis.' });

  try {
    const role = await myRole(communityId, userId);
    if (!role) return res.status(403).json({ error: 'Vous n\'êtes pas membre de cette communauté.' });

    const memberIds = Array.from(new Set((Array.isArray(memberUserIds) ? memberUserIds : []).filter((id) => id && id !== userId)));
    const conversation = await prisma.conversation.create({
      data: {
        isGroup: true,
        isAnnouncement: false,
        name: name.trim(),
        communityId,
        participants: { create: [userId, ...memberIds].map((id) => ({ userId: id })) },
      },
      include: { participants: { include: { user: true } } },
    });

    notifyConversationCreated(req, Object.assign({}, conversation, { messages: [] }), userId);

    return res.status(201).json({ conversationId: conversation.id });
  } catch (err) {
    console.error('createCommunityGroup error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la création du groupe.' });
  }
}

// Ajoute un membre à la communauté (et à son groupe d'annonces) — admin uniquement.
async function addCommunityMember(req, res) {
  const userId = req.user.id;
  const { communityId } = req.params;
  const { userId: newUserId } = req.body || {};
  if (!newUserId) return res.status(400).json({ error: 'userId requis.' });

  try {
    const role = await myRole(communityId, userId);
    if (role !== 'admin') return res.status(403).json({ error: 'Seuls les admins peuvent ajouter des membres.' });

    await prisma.communityMember.upsert({
      where: { communityId_userId: { communityId, userId: newUserId } },
      update: {},
      create: { communityId, userId: newUserId, role: 'member' },
    });

    const announcement = await prisma.conversation.findFirst({ where: { communityId, isAnnouncement: true } });
    if (announcement) {
      await prisma.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId: announcement.id, userId: newUserId } },
        update: {},
        create: { conversationId: announcement.id, userId: newUserId },
      });

      // Le nouveau membre doit voir apparaître le groupe d'annonces dans ses
      // discussions immédiatement, sans attendre un rechargement.
      const fullAnnouncement = await prisma.conversation.findUnique({
        where: { id: announcement.id },
        include: { participants: { include: { user: true } } },
      });
      notifyConversationCreated(req, Object.assign({}, fullAnnouncement, { messages: [] }), userId);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('addCommunityMember error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// Retire un membre de la communauté : un admin peut retirer n'importe qui
// (sauf lui-même s'il est seul admin), ou un membre peut se retirer lui-même.
async function removeCommunityMember(req, res) {
  const userId = req.user.id;
  const { communityId, memberUserId } = req.params;

  try {
    const role = await myRole(communityId, userId);
    if (!role) return res.status(403).json({ error: 'Vous n\'êtes pas membre de cette communauté.' });
    if (memberUserId !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'Seuls les admins peuvent retirer d\'autres membres.' });
    }

    await prisma.communityMember.delete({
      where: { communityId_userId: { communityId, userId: memberUserId } },
    }).catch(() => null);

    const announcement = await prisma.conversation.findFirst({ where: { communityId, isAnnouncement: true } });
    if (announcement) {
      await prisma.conversationParticipant.deleteMany({ where: { conversationId: announcement.id, userId: memberUserId } });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('removeCommunityMember error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = {
  listCommunities,
  getCommunity,
  createCommunity,
  createCommunityGroup,
  addCommunityMember,
  removeCommunityMember,
};
