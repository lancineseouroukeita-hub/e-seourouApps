# ==========================================================
# Script seourouApps : onglet Appels (historique reel) + routes
# ==========================================================
# A COPIER-COLLER EN UNE SEULE FOIS DANS POWERSHELL, depuis le dossier
# racine du projet (celui qui contient le dossier "backend" et ".git").
# Ecrit les fichiers SANS BOM directement (evite le probleme rencontre
# la derniere fois avec Set-Content -Encoding utf8).
# ==========================================================

# ---- backend/src/index.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src" | Out-Null
$content = @'
﻿require('dotenv').config();
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
const { setupSocket } = require('./sockets');

const app = express();
const server = http.createServer(app);

const corsOriginEnv = process.env.CORS_ORIGIN || '*';
const corsOrigin = corsOriginEnv === '*' ? '*' : corsOriginEnv.split(',');

app.use(cors({ origin: corsOrigin }));
// Limite par défaut d'express.json() : 100 Ko, trop petit pour la photo de
// profil envoyée en base64 (jusqu'à ~2 Mo, voir user.controller.js).
app.use(express.json({ limit: '3mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/calls', callRoutes);

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

# ---- backend/src/controllers/call.controller.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src\controllers" | Out-Null
$content = @'
const prisma = require('../config/prisma');

// Historique des appels (onglet "Appels", comme WhatsApp) : tous les appels des
// conversations auxquelles je participe, avec pour chacun mon statut (décroché
// / manqué), le sens (sortant / entrant) et la durée si j'ai réellement rejoint
// l'appel. Un appel "manqué" est un appel dont j'ai fait partie de la
// conversation visée mais que je n'ai jamais rejoint (pas de CallParticipant
// pour moi) — c'est le seul signal disponible côté serveur, il n'y a pas de
// notion explicite "d'appelant" stockée sur le modèle Call lui-même.
async function listCalls(req, res) {
  const userId = req.user.id;

  const participations = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true },
  });
  const conversationIds = participations.map((p) => p.conversationId);
  if (conversationIds.length === 0) return res.json({ calls: [] });

  const calls = await prisma.call.findMany({
    where: { conversationId: { in: conversationIds } },
    include: {
      conversation: { include: { participants: { include: { user: true } } } },
      participants: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });

  const result = calls.map((call) => {
    const myPart = call.participants.find((p) => p.userId === userId);
    const otherConvParticipants = call.conversation.participants.filter((p) => p.userId !== userId);
    const other = otherConvParticipants[0]; // suffisant pour une conversation 1-à-1
    const firstJoiner = call.participants[0]; // premier arrivé dans l'appel = considéré comme l'appelant
    const missed = !myPart;
    const outgoing = Boolean(firstJoiner && firstJoiner.userId === userId);

    let duration = null;
    if (myPart && myPart.leftAt) {
      duration = Math.max(0, Math.round((new Date(myPart.leftAt) - new Date(myPart.joinedAt)) / 1000));
    }

    return {
      id: call.id,
      conversationId: call.conversationId,
      type: call.type,
      isGroup: call.conversation.isGroup,
      label: call.conversation.isGroup ? (call.conversation.name || 'Groupe') : (other ? other.user.name : '—'),
      avatarUrl: !call.conversation.isGroup && other ? other.user.avatarUrl : null,
      startedAt: call.startedAt,
      missed,
      outgoing,
      duration,
    };
  });

  return res.json({ calls: result });
}

module.exports = { listCalls };

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\controllers\call.controller.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- backend/src/routes/call.routes.js ----
New-Item -ItemType Directory -Force -Path ".\backend\src\routes" | Out-Null
$content = @'
const express = require('express');
const { listCalls } = require('../controllers/call.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listCalls);

module.exports = router;

'@
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "backend\src\routes\call.routes.js"), $content, (New-Object System.Text.UTF8Encoding($false)))

# ---- Verification avant commit ----
git status
git diff --stat

Write-Host ""
Write-Host "Verifiez que le resume ci-dessus correspond bien aux fichiers listes plus haut," -ForegroundColor Yellow
Write-Host "puis continuez avec les 3 commandes suivantes UNE PAR UNE :" -ForegroundColor Yellow
Write-Host '  git add backend/src' -ForegroundColor Cyan
Write-Host '  git commit -m "Ajoute un onglet Appels avec historique reel des appels"' -ForegroundColor Cyan
Write-Host '  git push' -ForegroundColor Cyan