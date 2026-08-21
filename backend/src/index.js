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
const prisma = require('./config/prisma');

// Filet de sécurité de tout dernier recours : une promesse rejetée jamais
// rattrapée nulle part (un handler Socket.io oublié, une tâche de fond, etc.)
// ferait par défaut planter tout le process Node (donc déconnecter tous les
// utilisateurs) au lieu de rester une simple erreur ponctuelle. Ça ne remplace
// PAS une vraie gestion d'erreurs (voir asyncHandler.js pour les routes REST,
// et les try/catch dans les gestionnaires Socket.io), juste un dernier
// rattrapage pour éviter une coupure totale du service en cas d'oubli.
process.on('unhandledRejection', (err) => {
  console.error('Rejet de promesse non géré (voir asyncHandler.js / try-catch manquant) :', err);
});

const app = express();
const server = http.createServer(app);
// Nécessaire derrière le proxy inverse de Render pour que req.ip renvoie la
// vraie IP du client (sinon tout le monde partagerait la même IP interne du
// proxy, ce qui casserait le rate limiting par IP — voir utils/rateLimit.js).
app.set('trust proxy', 1);

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

// Gestionnaire d'erreurs générique (dernier recours) : reçoit maintenant
// aussi toutes les erreurs des contrôleurs REST via asyncHandler (voir
// utils/asyncHandler.js), en plus des erreurs internes à Express (ex: JSON
// mal formé renvoyé par express.json(), qui porte déjà un vrai statusCode
// 400 — le respecter plutôt que de toujours répondre 500 évite d'annoncer
// une "erreur serveur" pour ce qui est en réalité une requête invalide).
app.use((err, req, res, next) => {
  console.error(err);
  const rawStatus = err.statusCode || err.status;
  const status = (typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 500) ? rawStatus : 500;
  res.status(status).json({ error: status === 500 ? 'Erreur serveur interne.' : (err.message || 'Requête invalide.') });
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

  // Les appels en cours (Call.status === 'ongoing') sont suivis en mémoire
  // (activeCalls/pendingDisconnectLeaves, voir sockets/signaling.js), qui est
  // vidée à chaque redémarrage/redéploiement. Un appel encore marqué "ongoing"
  // en base à ce moment-là est donc forcément obsolète (plus aucun socket ne
  // le referme jamais) : on le clôture ici pour ne pas fausser l'historique
  // des appels affiché dans l'application (onglet "Appels").
  prisma.call.updateMany({
    where: { status: 'ongoing' },
    data: { status: 'ended', endedAt: new Date() },
  }).then((res) => {
    if (res.count > 0) console.log(`${res.count} appel(s) "en cours" obsolète(s) (avant redémarrage) clôturé(s).`);
  }).catch((err) => {
    console.error('Clôture des appels obsolètes échouée :', err);
  });
});
