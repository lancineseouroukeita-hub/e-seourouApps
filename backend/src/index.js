ï»¿require('dotenv').config();
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
// Limite par dÃ©faut d'express.json() : 100 Ko, trop petit pour la photo de
// profil envoyÃ©e en base64 (jusqu'Ã  ~2 Mo, voir user.controller.js).
app.use(express.json({ limit: '3mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/calls', callRoutes);

// Sert l'application web (testeur/PWA) : le dossier public/ contient index.html,
// le manifest PWA, le service worker et les icÃ´nes. Comme c'est servi par ce mÃªme
// serveur, il n'y a plus besoin de lancer un second serveur (ex: "npx serve") ni de
// configurer une URL d'API diffÃ©rente : tout est sur la mÃªme origine.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Gestionnaire d'erreurs gÃ©nÃ©rique (dernier recours)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur interne.' });
});

const io = new Server(server, {
  cors: { origin: corsOrigin },
  // Par dÃ©faut, socket.io limite chaque message Ã  ~1 Mo, ce qui est trop petit
  // pour les piÃ¨ces jointes (photos, notes vocales) envoyÃ©es encodÃ©es en base64.
  // On autorise jusqu'Ã  8 Mo par message (une piÃ¨ce jointe est limitÃ©e Ã  5 Mo
  // cÃ´tÃ© client avant encodage, l'encodage base64 ajoute ~33% de taille).
  maxHttpBufferSize: 8 * 1024 * 1024,
});
setupSocket(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Serveur API + signalisation WebRTC dÃ©marrÃ© sur le port ${PORT}`);
});
