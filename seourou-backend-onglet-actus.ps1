# ==========================================================
# Script seourouApps : onglet Actus (Statuts texte/photo 24h)
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

  participants ConversationParticipant[]
  messages     Message[]
  calls        Call[]
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

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\prisma\schema.prisma"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/prisma/migrations/20260820160000_add_status/migration.sql ----
New-Item -ItemType Directory -Force -Path ".\backend\prisma\migrations\20260820160000_add_status" | Out-Null
$content = @'
-- CreateTable
CREATE TABLE "Status" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "backgroundColor" TEXT,
    "attachmentData" TEXT,
    "attachmentMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusView" (
    "id" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatusView_statusId_viewerId_key" ON "StatusView"("statusId", "viewerId");

-- AddForeignKey
ALTER TABLE "Status" ADD CONSTRAINT "Status_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusView" ADD CONSTRAINT "StatusView_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusView" ADD CONSTRAINT "StatusView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\prisma\migrations\20260820160000_add_status\migration.sql"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/src/controllers/status.controller.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src\controllers" | Out-Null
$content = @'
const prisma = require('../config/prisma');
const { isBlockedBetween } = require('../utils/blocking');

const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24h, comme les Statuts WhatsApp
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // même limite que les pièces jointes du chat

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

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\controllers\status.controller.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/src/routes/status.routes.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src\routes" | Out-Null
$content = @'
const express = require('express');
const { listStatuses, createStatus, viewStatus, deleteStatus } = require('../controllers/status.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listStatuses);
router.post('/', requireAuth, createStatus);
router.post('/:statusId/view', requireAuth, viewStatus);
router.delete('/:statusId', requireAuth, deleteStatus);

module.exports = router;

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\routes\status.routes.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

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

# ---- Verification avant commit ----
git status
git diff --stat

Write-Host ""
Write-Host "Verifiez que le resume ci-dessus correspond bien aux fichiers listes plus haut," -ForegroundColor Yellow
Write-Host "puis continuez avec les 3 commandes suivantes UNE PAR UNE :" -ForegroundColor Yellow
Write-Host '  git add backend/prisma backend/src backend/public/index.html' -ForegroundColor Cyan
Write-Host '  git commit -m "Ajoute les Statuts (onglet Actus) : texte colore ou photo, visibles 24h"' -ForegroundColor Cyan
Write-Host '  git push' -ForegroundColor Cyan