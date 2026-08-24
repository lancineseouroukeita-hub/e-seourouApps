# ==========================================================
# Script seourouApps : onglet Communautes (groupes + annonces)
# ==========================================================
# A COPIER-COLLER EN UNE SEULE FOIS DANS POWERSHELL, depuis le dossier
# racine du projet (celui qui contient le dossier "backend" et ".git").
# Ecrit les fichiers SANS BOM directement.
# ==========================================================

# ---- backend/prisma/schema.prisma ----
New-Item -ItemType Directory -Force -Path ".\backend\prisma" | Out-Null
$content = @'
// Schéma de base de données pour l'application de communication
// Documentation: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String   @id @default(uuid())
  name        String
  phone       String   @unique
  password    String
  avatarUrl   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  participations ConversationParticipant[]
  messages        Message[]
  callParticipations CallParticipant[]
  pushSubscriptions  PushSubscription[]
  // Utilisateurs que j'ai bloqués, et utilisateurs qui m'ont bloqué (Paramètres → Confidentialité).
  blockedUsers   BlockedUser[] @relation("BlockerRelation")
  blockedByUsers BlockedUser[] @relation("BlockedRelation")
  // Statuts (onglet "Actus") : ceux que j'ai publiés, et ceux que j'ai vus.
  statuses     Status[]
  statusViews  StatusView[]
  // Communautés (onglet "Communautés") : celles que j'ai créées, et celles
  // auxquelles j'appartiens (en tant que membre ou admin).
  createdCommunities Community[]
  communityMemberships CommunityMember[]
}

// Un utilisateur bloqué ne peut plus envoyer de message ni appeler la personne
// qui l'a bloqué (vérifié dans les deux sens dans les gestionnaires socket).
// Un même couple (blockerId, blockedId) ne peut exister qu'une fois.
model BlockedUser {
  id        String   @id @default(uuid())
  blockerId String
  blockedId String
  createdAt DateTime @default(now())

  blocker User @relation("BlockerRelation", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked User @relation("BlockedRelation", fields: [blockedId], references: [id], onDelete: Cascade)

  @@unique([blockerId, blockedId])
}

model Conversation {
  id        String   @id @default(uuid())
  isGroup   Boolean  @default(false)
  name      String?  // utilisé seulement pour les conversations de groupe
  createdAt DateTime @default(now())

  // Rattachement optionnel à une Communauté (onglet "Communautés") : un groupe
  // "normal" de la communauté, ou son unique groupe d'annonces (isAnnouncement),
  // où seuls les admins de la communauté peuvent écrire (vérifié dans chat.js).
  communityId    String?
  isAnnouncement Boolean @default(false)

  participants ConversationParticipant[]
  messages     Message[]
  calls        Call[]
  community    Community? @relation(fields: [communityId], references: [id], onDelete: SetNull)
}

model ConversationParticipant {
  id             String   @id @default(uuid())
  conversationId String
  userId         String
  joinedAt       DateTime @default(now())
  // Dernière fois que cet utilisateur a ouvert/vu la conversation : sert à savoir
  // quels messages envoyés par les AUTRES participants ont été "lus" par lui
  // (affichage des doubles coches ✓✓, comme WhatsApp/iMessage).
  lastReadAt     DateTime?

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([conversationId, userId])
}

model Message {
  id             String   @id @default(uuid())
  conversationId String
  senderId       String
  content        String
  createdAt      DateTime @default(now())

  // Pièce jointe optionnelle (photo, fichier ou message vocal).
  // "type" vaut "text" (par défaut), "image", "file" ou "voice".
  // Le contenu binaire est stocké encodé en base64 directement dans la base
  // Neon (pas de service de stockage externe) : suffisant pour des fichiers
  // de quelques Mo (photos compressées, notes vocales courtes/moyennes).
  type            String  @default("text")
  attachmentData  String? // contenu du fichier encodé en base64
  attachmentMime  String? // ex: "image/jpeg", "audio/webm", "application/pdf"
  attachmentName  String? // nom du fichier d'origine
  attachmentSize  Int?    // taille en octets du fichier d'origine
  duration        Int?    // durée en secondes, pour les messages vocaux

  // Suppression "douce" : la ligne reste (pour ne pas casser l'historique/les
  // aperçus), mais le contenu et la pièce jointe sont effacés et remplacés par
  // un texte de substitution ("Message supprimé") côté client.
  deleted         Boolean @default(false)

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender       User         @relation(fields: [senderId], references: [id], onDelete: Cascade)
}

model Call {
  id             String    @id @default(uuid())
  conversationId String
  type           String    // "video" | "audio"
  status         String    @default("ongoing") // "ongoing" | "ended"
  startedAt      DateTime  @default(now())
  endedAt        DateTime?

  conversation Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  participants CallParticipant[]
}

model CallParticipant {
  id       String    @id @default(uuid())
  callId   String
  userId   String
  joinedAt DateTime  @default(now())
  leftAt   DateTime?

  call Call @relation(fields: [callId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Abonnement du navigateur/appareil aux notifications push (Web Push standard).
// Un même utilisateur peut avoir plusieurs abonnements (un par appareil/navigateur
// où il s'est connecté et a autorisé les notifications).
model PushSubscription {
  id        String   @id @default(uuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Statut (onglet "Actus", comme les Statuts WhatsApp) : texte coloré ou photo,
// visible par tous les utilisateurs (pas de notion de "contacts" dans cette
// appli) pendant 24h, puis expiré (filtré côté serveur, jamais réellement
// supprimé automatiquement — plus simple qu'une tâche planifiée).
model Status {
  id              String   @id @default(uuid())
  userId          String
  type            String   // "text" | "photo"
  content         String?  // texte du statut, ou légende facultative d'une photo
  backgroundColor String?  // couleur de fond pour un statut texte (ex: "#25d366")
  attachmentData  String?  // photo encodée en base64, pour un statut photo
  attachmentMime  String?
  createdAt       DateTime @default(now())
  expiresAt       DateTime

  user  User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  views StatusView[]
}

// Vue d'un statut par un utilisateur (pour afficher "vu par X personnes" à
// l'auteur, et distinguer les statuts déjà vus des nouveaux côté lecteur).
model StatusView {
  id       String   @id @default(uuid())
  statusId String
  viewerId String
  viewedAt DateTime @default(now())

  status Status @relation(fields: [statusId], references: [id], onDelete: Cascade)
  viewer User   @relation(fields: [viewerId], references: [id], onDelete: Cascade)

  @@unique([statusId, viewerId])
}

// Communauté (onglet "Communautés", comme WhatsApp) : regroupe plusieurs
// discussions de groupe sous un même nom, avec un groupe d'annonces
// (Conversation.isAnnouncement = true) créé automatiquement, où seuls les
// admins de la communauté peuvent écrire.
model Community {
  id          String   @id @default(uuid())
  name        String
  description String?
  creatorId   String
  createdAt   DateTime @default(now())

  creator       User              @relation(fields: [creatorId], references: [id], onDelete: Cascade)
  members       CommunityMember[]
  conversations Conversation[]
}

model CommunityMember {
  id          String   @id @default(uuid())
  communityId String
  userId      String
  role        String   @default("member") // "admin" | "member"
  joinedAt    DateTime @default(now())

  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([communityId, userId])
}

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\prisma\schema.prisma"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/prisma/migrations/20260820170000_add_communities/migration.sql ----
New-Item -ItemType Directory -Force -Path ".\backend\prisma\migrations\20260820170000_add_communities" | Out-Null
$content = @'
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "isAnnouncement" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMember" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_communityId_userId_key" ON "CommunityMember"("communityId", "userId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\prisma\migrations\20260820170000_add_communities\migration.sql"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/src/controllers/community.controller.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src\controllers" | Out-Null
$content = @'
const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');

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
    });
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

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\controllers\community.controller.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/src/routes/community.routes.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src\routes" | Out-Null
$content = @'
const express = require('express');
const {
  listCommunities,
  getCommunity,
  createCommunity,
  createCommunityGroup,
  addCommunityMember,
  removeCommunityMember,
} = require('../controllers/community.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listCommunities);
router.post('/', requireAuth, createCommunity);
router.get('/:communityId', requireAuth, getCommunity);
router.post('/:communityId/groups', requireAuth, createCommunityGroup);
router.post('/:communityId/members', requireAuth, addCommunityMember);
router.delete('/:communityId/members/:memberUserId', requireAuth, removeCommunityMember);

module.exports = router;

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\routes\community.routes.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/src/index.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src" | Out-Null
$content = @'
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const conversationRoutes = require('./routes/conversation.routes');
const pushRoutes = require('./routes/push.routes');
const callRoutes = require('./routes/call.routes');
const statusRoutes = require('./routes/status.routes');
const communityRoutes = require('./routes/community.routes');
const { setupSocket } = require('./sockets');

const app = express();
const server = http.createServer(app);

const corsOriginEnv = process.env.CORS_ORIGIN || '*';
const corsOrigin = corsOriginEnv === '*' ? '*' : corsOriginEnv.split(',');

app.use(cors({ origin: corsOrigin }));
// Limite par défaut d'express.json() : 100 Ko, trop petit pour la photo de
// profil (jusqu'à ~2 Mo, voir user.controller.js) ou une photo de statut
// (jusqu'à 5 Mo, voir status.controller.js) envoyées en base64 (+33% de
// taille par rapport au fichier d'origine une fois encodées).
app.use(express.json({ limit: '8mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/statuses', statusRoutes);
app.use('/api/communities', communityRoutes);

// Sert l'application web (testeur/PWA) : le dossier public/ contient index.html,
// le manifest PWA, le service worker et les icônes. Comme c'est servi par ce même
// serveur, il n'y a plus besoin de lancer un second serveur (ex: "npx serve") ni de
// configurer une URL d'API différente : tout est sur la même origine.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Gestionnaire d'erreurs générique (dernier recours)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur interne.' });
});

const io = new Server(server, {
  cors: { origin: corsOrigin },
  // Par défaut, socket.io limite chaque message à ~1 Mo, ce qui est trop petit
  // pour les pièces jointes (photos, notes vocales) envoyées encodées en base64.
  // On autorise jusqu'à 8 Mo par message (une pièce jointe est limitée à 5 Mo
  // côté client avant encodage, l'encodage base64 ajoute ~33% de taille).
  maxHttpBufferSize: 8 * 1024 * 1024,
});
setupSocket(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Serveur API + signalisation WebRTC démarré sur le port ${PORT}`);
});

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\index.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/src/sockets/chat.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src\sockets" | Out-Null
$content = @'
const prisma = require('../config/prisma');
const { toPublicUser } = require('../controllers/auth.controller');
const { previewLabel } = require('../controllers/conversation.controller');
const { sendPushToUser } = require('../utils/push');
const { isBlockedBetween } = require('../utils/blocking');

// Taille max d'un fichier joint (avant encodage) : 5 Mo. Une fois encodé en
// base64, une chaîne grossit d'environ 33% (4 caractères pour 3 octets), d'où
// cette marge lors de la vérification côté serveur.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024;

/**
 * Attache les gestionnaires d'événements liés à la messagerie texte sur un socket déjà authentifié.
 * L'utilisateur rejoint automatiquement une "room" par conversation pour recevoir les nouveaux messages.
 */
function registerChatHandlers(io, socket) {
  const userId = socket.user.id;

  // Rejoint les rooms de toutes les conversations de l'utilisateur au moment de la connexion.
  (async () => {
    const participations = await prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    participations.forEach((p) => socket.join(roomName(p.conversationId)));
  })();

  // Permet de rejoindre la room d'une conversation nouvellement créée sans reconnecter le socket.
  socket.on('conversation:join', ({ conversationId }) => {
    if (conversationId) socket.join(roomName(conversationId));
  });

  socket.on('message:send', async ({ conversationId, content, attachment }, callback) => {
    try {
      const trimmedContent = (content || '').trim();
      const hasAttachment = attachment && attachment.data;

      if (!conversationId || (!trimmedContent && !hasAttachment)) {
        return callback && callback({ error: 'conversationId et un contenu (texte ou pièce jointe) sont requis.' });
      }

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      // Discussion 1-à-1 avec un utilisateur bloqué (par moi ou par lui) : on
      // bloque l'envoi dans les deux sens (Paramètres → Confidentialité).
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { select: { userId: true } } },
      });
      if (!conv) return callback && callback({ error: 'Conversation introuvable.' });
      if (!conv.isGroup) {
        const other = conv.participants.find((p) => p.userId !== userId);
        if (other && await isBlockedBetween(userId, other.userId)) {
          return callback && callback({ error: 'Impossible d\'envoyer ce message : utilisateur bloqué.' });
        }
      }

      // Groupe d'annonces d'une Communauté : seuls les admins de la communauté
      // peuvent y écrire (comme le groupe d'annonces des Communautés WhatsApp).
      if (conv.isAnnouncement && conv.communityId) {
        const membership = await prisma.communityMember.findUnique({
          where: { communityId_userId: { communityId: conv.communityId, userId } },
        });
        if (!membership || membership.role !== 'admin') {
          return callback && callback({ error: 'Seuls les admins de la communauté peuvent écrire dans ce groupe d\'annonces.' });
        }
      }

      let data = {
        conversationId,
        senderId: userId,
        content: trimmedContent,
      };

      if (hasAttachment) {
        // Garde-fou côté serveur : même si le client limite déjà la taille des
        // fichiers, on revérifie ici (le champ "data" est la chaîne base64).
        if (attachment.data.length > MAX_ATTACHMENT_BASE64_LENGTH) {
          return callback && callback({ error: 'Fichier trop volumineux (5 Mo maximum).' });
        }
        const type = ['image', 'voice', 'file'].includes(attachment.type) ? attachment.type : 'file';
        data = {
          ...data,
          type,
          attachmentData: attachment.data,
          attachmentMime: attachment.mime || 'application/octet-stream',
          attachmentName: attachment.name || null,
          attachmentSize: Number.isFinite(attachment.size) ? attachment.size : null,
          duration: Number.isFinite(attachment.duration) ? attachment.duration : null,
        };
      }

      const message = await prisma.message.create({
        data,
        include: { sender: true },
      });

      const payload = {
        id: message.id,
        conversationId,
        content: message.content,
        type: message.type,
        deleted: false,
        attachment: hasAttachment ? {
          data: message.attachmentData,
          mime: message.attachmentMime,
          name: message.attachmentName,
          size: message.attachmentSize,
          duration: message.duration,
        } : null,
        createdAt: message.createdAt,
        sender: toPublicUser(message.sender),
      };

      io.to(roomName(conversationId)).emit('message:new', payload);
      callback && callback({ message: payload });

      // Notification push : prévient les autres participants même si l'app est
      // fermée (le socket ci-dessus ne touche que ceux qui ont l'app ouverte).
      // Ne doit jamais faire échouer l'envoi du message si ça plante.
      notifyNewMessage(conversationId, userId, message).catch((err) => {
        console.error('push notify (message) error:', err);
      });
    } catch (err) {
      console.error('message:send error:', err);
      callback && callback({ error: 'Erreur serveur lors de l\'envoi du message.' });
    }
  });

  socket.on('typing', ({ conversationId, isTyping }) => {
    if (!conversationId) return;
    socket.to(roomName(conversationId)).emit('typing', {
      conversationId,
      userId,
      isTyping: Boolean(isTyping),
    });
  });

  // Suppression d'un message : seul son auteur peut le faire. On garde la ligne
  // en base (suppression "douce") mais on efface le contenu/la pièce jointe, et
  // on prévient tout le monde dans la conversation pour que l'affichage se
  // remplace par "Message supprimé" en direct, des deux côtés.
  socket.on('message:delete', async ({ messageId }, callback) => {
    try {
      if (!messageId) return callback && callback({ error: 'messageId requis.' });

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      if (message.senderId !== userId) {
        return callback && callback({ error: 'Vous ne pouvez supprimer que vos propres messages.' });
      }

      await prisma.message.update({
        where: { id: messageId },
        data: {
          deleted: true,
          content: '',
          attachmentData: null,
          attachmentMime: null,
          attachmentName: null,
          attachmentSize: null,
          duration: null,
        },
      });

      io.to(roomName(message.conversationId)).emit('message:deleted', {
        conversationId: message.conversationId,
        messageId,
      });
      callback && callback({ ok: true });
    } catch (err) {
      console.error('message:delete error:', err);
      callback && callback({ error: 'Erreur serveur lors de la suppression du message.' });
    }
  });

  // Effacement définitif de la trace "Message supprimé" : contrairement à
  // message:delete (suppression "douce", qui garde la ligne pour l'aperçu de
  // la conversation), ici on supprime réellement la ligne en base. La bulle
  // "🚫 Message supprimé" disparaît alors complètement de la conversation,
  // pour tout le monde, y compris après rechargement de l'historique.
  // Uniquement possible sur un message déjà passé par message:delete, et
  // uniquement par son auteur.
  socket.on('message:erase', async ({ messageId }, callback) => {
    try {
      if (!messageId) return callback && callback({ error: 'messageId requis.' });

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      if (message.senderId !== userId) {
        return callback && callback({ error: 'Vous ne pouvez effacer que vos propres messages.' });
      }
      if (!message.deleted) {
        return callback && callback({ error: 'Supprimez d\'abord ce message avant de l\'effacer définitivement.' });
      }

      await prisma.message.delete({ where: { id: messageId } });

      io.to(roomName(message.conversationId)).emit('message:erased', {
        conversationId: message.conversationId,
        messageId,
      });
      callback && callback({ ok: true });
    } catch (err) {
      console.error('message:erase error:', err);
      callback && callback({ error: 'Erreur serveur lors de l\'effacement du message.' });
    }
  });

  // Marque la conversation comme lue par l'utilisateur courant à cet instant.
  // Sert à afficher les doubles coches (✓✓) sur les messages envoyés par les
  // autres participants dès qu'ils ont ouvert la conversation (comme WhatsApp).
  socket.on('conversation:read', async ({ conversationId }) => {
    if (!conversationId) return;
    try {
      const readAt = new Date();
      await prisma.conversationParticipant.updateMany({
        where: { conversationId, userId },
        data: { lastReadAt: readAt },
      });
      socket.to(roomName(conversationId)).emit('conversation:read-receipt', {
        conversationId,
        userId,
        readAt,
      });
    } catch (err) {
      console.error('conversation:read error:', err);
    }
  });
}

// Envoie une notification push à tous les autres participants de la conversation
// (le service worker décide lui-même de l'afficher ou non si l'app est déjà au premier plan).
async function notifyNewMessage(conversationId, senderId, message) {
  const [sender, others] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId } }),
    prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: senderId } },
      select: { userId: true },
    }),
  ]);
  if (!sender || others.length === 0) return;

  const body = previewLabel(message);
  await Promise.all(others.map((p) => sendPushToUser(p.userId, {
    title: sender.name,
    body,
    tag: 'conversation:' + conversationId,
    data: { type: 'message', conversationId },
  })));
}

function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

module.exports = { registerChatHandlers, roomName };

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\sockets\chat.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- Verification avant commit ----
git status
git diff --stat

Write-Host ""
Write-Host "Verifiez que le resume ci-dessus correspond bien aux fichiers listes plus haut," -ForegroundColor Yellow
Write-Host "puis continuez avec les 3 commandes suivantes UNE PAR UNE :" -ForegroundColor Yellow
Write-Host '  git add backend/prisma backend/src backend/public/index.html' -ForegroundColor Cyan
Write-Host '  git commit -m "Ajoute les Communautes : groupes regroupes + groupe d''annonces"' -ForegroundColor Cyan
Write-Host '  git push' -ForegroundColor Cyan