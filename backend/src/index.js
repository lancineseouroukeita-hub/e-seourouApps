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

// Accessible depuis les contrôleurs REST (req.app.get('io')) pour notifier en
// temps réel les participants d'une conversation/communauté créée via l'API
// HTTP (ex: nouvelle discussion, nouveau groupe) — sans ça, un participant
// ajouté à une conversation existante ne la voit apparaître qu'après avoir
// rechargé l'application, puisque son socket n'a jamais rejoint cette room.
app.set('io', io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Serveur API + signalisation WebRTC démarré sur le port ${PORT}`);
});
