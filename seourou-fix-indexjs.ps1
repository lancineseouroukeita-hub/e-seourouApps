# ==========================================================
# Correctif : backend/src/index.js contenait un caractere
# invisible corrompu au tout debut du fichier, provoquant
# "SyntaxError: Invalid or unexpected token" au demarrage sur Render.
# Ce script reecrit le fichier proprement, sans ce caractere.
# A COPIER-COLLER EN UNE SEULE FOIS DANS POWERSHELL, depuis le dossier
# racine du projet (celui qui contient le dossier "backend" et ".git").
# ==========================================================

# ---- backend/src/index.js ----
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

# ---- Verification avant commit ----
git status
git diff --stat

Write-Host ""
Write-Host "Verifiez que seul backend/src/index.js est modifie ci-dessus," -ForegroundColor Yellow
Write-Host "puis continuez avec les 3 commandes suivantes UNE PAR UNE :" -ForegroundColor Yellow
Write-Host '  git add backend/src/index.js' -ForegroundColor Cyan
Write-Host '  git commit -m "Corrige un caractere invisible dans index.js qui bloquait le demarrage"' -ForegroundColor Cyan
Write-Host '  git push' -ForegroundColor Cyan