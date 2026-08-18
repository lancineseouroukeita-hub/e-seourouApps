require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const conversationRoutes = require('./routes/conversation.routes');
const { setupSocket } = require('./sockets');

const app = express();
const server = http.createServer(app);

const corsOriginEnv = process.env.CORS_ORIGIN || '*';
const corsOrigin = corsOriginEnv === '*' ? '*' : corsOriginEnv.split(',');

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);

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
});
setupSocket(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Serveur API + signalisation WebRTC démarré sur le port ${PORT}`);
});
