# seourouApps — Application de communication (chat + appels vidéo/audio)

Application complète composée de deux parties :

- **`backend/`** — API REST (authentification, contacts, conversations, messages) + serveur
  Socket.io pour la messagerie en temps réel et la signalisation WebRTC.
- **`mobile/`** — Application React Native (iOS + Android) : inscription/connexion, liste de
  contacts, messagerie texte, appels vidéo/audio 1-à-1 et de groupe.

## Fonctionnalités incluses

- Comptes utilisateurs (inscription, connexion, session persistée avec JWT)
- Liste des contacts / autres utilisateurs
- Messagerie texte en temps réel (conversations 1-à-1 et groupes)
- Appels vidéo et audio 1-à-1
- Appels de groupe en topologie **mesh** (chaque participant se connecte directement à
  chaque autre — adapté à de petits groupes, voir la section "Limites" ci-dessous)

## Prérequis

- Node.js 18+ et npm
- PostgreSQL (local, ou un service comme Neon/Supabase/Railway)
- Pour l'app mobile : un environnement React Native fonctionnel
  ([guide officiel](https://reactnative.dev/docs/set-up-your-environment)) — Xcode pour iOS
  (macOS uniquement), Android Studio + SDK pour Android
- Un appareil physique ou un émulateur/simulateur avec caméra et micro pour tester les appels
  (les émulateurs/simulateurs peuvent nécessiter une configuration spéciale pour la caméra)

---

## 1. Installer et lancer le backend

```bash
cd backend
npm install
cp .env.example .env
```

Modifiez `.env` :
- `DATABASE_URL` : URL de connexion à votre base PostgreSQL
- `JWT_SECRET` : remplacez par une chaîne aléatoire longue et secrète
- `PORT` : port d'écoute (4000 par défaut)

Créez les tables de la base de données à partir du schéma Prisma :

```bash
npx prisma migrate dev --name init
```

Démarrez le serveur en mode développement (rechargement automatique) :

```bash
npm run dev
```

Le serveur écoute par défaut sur `http://localhost:4000`. Vérifiez qu'il fonctionne :

```bash
curl http://localhost:4000/health
# -> {"status":"ok"}
```

### Aperçu de l'API

| Méthode | Route                                   | Description                              |
|---------|------------------------------------------|-------------------------------------------|
| POST    | `/api/auth/register`                    | Créer un compte                          |
| POST    | `/api/auth/login`                       | Se connecter, retourne un JWT            |
| GET     | `/api/auth/me`                          | Profil de l'utilisateur connecté         |
| GET     | `/api/users`                            | Liste des autres utilisateurs            |
| GET     | `/api/conversations`                    | Liste des conversations de l'utilisateur |
| POST    | `/api/conversations`                    | Créer/récupérer une conversation         |
| GET     | `/api/conversations/:id/messages`       | Historique des messages                  |

Événements Socket.io (namespace par défaut, authentification via `auth: { token }` au handshake) :
`message:send`, `message:new`, `typing`, `call:join`, `call:incoming`, `call:signal`,
`call:user-joined`, `call:user-left`, `call:leave`.

---

## 2. Installer et lancer l'application mobile

Le dossier `mobile/` contient tout le **code source JavaScript** de l'application
(écrans, navigation, services). Comme `react-native-webrtc` nécessite du code natif,
il faut générer les dossiers natifs `ios/` et `android/` avec la CLI officielle React Native,
puis copier ce code source dedans.

### 2.1 Générer le projet natif

```bash
npx @react-native-community/cli init seourouApps --version 0.74.5
```

Cela crée un nouveau dossier `seourouApps/` avec les dossiers `ios/` et `android/`.

### 2.2 Copier le code source fourni

Depuis ce projet, copiez dans le dossier généré `seourouApps/` :
- `mobile/App.js` → `seourouApps/App.js` (remplace le fichier généré)
- `mobile/index.js` → `seourouApps/index.js` (remplace le fichier généré)
- `mobile/app.json` → fusionnez avec le `app.json` généré (gardez juste `name`/`displayName`,
  déjà réglés sur `seourouApps`)
- `mobile/babel.config.js`, `mobile/metro.config.js` → remplacent les fichiers générés
- `mobile/src/` → copiez le dossier entier dans `seourouApps/src/`
- Fusionnez les dépendances de `mobile/package.json` dans le `package.json` généré (section
  `dependencies`/`devDependencies`), puis lancez `npm install`

```bash
npm install @react-native-async-storage/async-storage \
  @react-navigation/native @react-navigation/native-stack \
  axios react-native-safe-area-context react-native-screens \
  react-native-webrtc socket.io-client
```

### 2.3 Configurer les permissions caméra/micro

**Android** — dans `android/app/src/main/AndroidManifest.xml`, ajoutez avant `<application>` :

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.BLUETOOTH" />
```

**iOS** — dans `ios/seourouApps/Info.plist`, ajoutez :

```xml
<key>NSCameraUsageDescription</key>
<string>Cette application a besoin d'accéder à la caméra pour les appels vidéo.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Cette application a besoin d'accéder au micro pour les appels audio/vidéo.</string>
```

Puis installez les pods :

```bash
cd ios && pod install && cd ..
```

Suivez également les instructions d'installation spécifiques à `react-native-webrtc`
(elles évoluent selon les versions) : https://github.com/react-native-webrtc/react-native-webrtc

### 2.4 Configurer l'URL du backend

Ouvrez `src/config.js` et ajustez `API_BASE_URL` :
- Émulateur Android : `http://10.0.2.2:4000` (valeur par défaut)
- Simulateur iOS : `http://localhost:4000`
- Appareil physique : `http://<IP-locale-de-votre-machine>:4000` (même réseau Wi-Fi que le téléphone)

### 2.5 Lancer l'application

```bash
# Terminal 1 : le bundler Metro
npx react-native start

# Terminal 2 : build + installation sur l'émulateur/appareil
npx react-native run-android
# ou
npx react-native run-ios
```

Créez deux comptes (sur deux appareils/émulateurs différents, ou via l'API directement) pour
tester la messagerie et les appels entre deux utilisateurs.

---

## Architecture des appels WebRTC

- Le serveur ne fait que relayer les messages de signalisation (offres/réponses SDP, candidats
  ICE) via Socket.io ; il ne traite jamais le flux audio/vidéo lui-même.
- Chaque participant établit une connexion `RTCPeerConnection` directe avec chaque autre
  participant ("mesh"). Pour un appel à `n` personnes, cela représente `n × (n-1) / 2` connexions
  pair-à-pair.
- Convention de négociation : quand quelqu'un rejoint un appel, les participants déjà présents
  lui envoient chacun une offre WebRTC.

### Limites à connaître

- **Scalabilité des groupes** : la topologie mesh fonctionne bien jusqu'à 4-6 participants.
  Au-delà, la charge réseau et CPU de chaque téléphone augmente rapidement. Pour des groupes
  plus grands, il faudrait introduire un serveur média (SFU) comme
  [mediasoup](https://mediasoup.org/), [LiveKit](https://livekit.io/) ou un service managé
  (Agora, Twilio Video, Daily.co).
- **Serveurs TURN** : seuls des serveurs STUN publics sont configurés (`src/config.js`). Cela
  suffit pour la plupart des tests, mais certains réseaux (NAT symétrique, réseaux d'entreprise)
  nécessitent un serveur TURN pour établir la connexion. Ajoutez-en un (ex: coturn auto-hébergé,
  ou un service comme Twilio/Xirsys) avant une mise en production.
- **Notifications push** : les appels/messages entrants ne sont signalés que lorsque
  l'application est ouverte et connectée au socket. Pour recevoir des appels quand l'app est en
  arrière-plan ou fermée, il faudrait intégrer des notifications push (Firebase Cloud Messaging /
  Apple Push Notification service) avec un mécanisme de "VoIP push" côté iOS.
- **Passage à l'échelle du serveur** : l'état des appels en cours est actuellement stocké en
  mémoire (`backend/src/sockets/signaling.js`). Pour faire tourner plusieurs instances du
  serveur derrière un load balancer, il faudrait partager cet état via Redis (et l'adaptateur
  Redis de Socket.io).

## Structure du projet

```
seourouApps/
├── backend/
│   ├── prisma/schema.prisma       # Schéma de base de données
│   └── src/
│       ├── index.js                # Point d'entrée (Express + Socket.io)
│       ├── config/prisma.js
│       ├── controllers/            # Logique métier (auth, users, conversations)
│       ├── middleware/auth.js      # Vérification du JWT
│       ├── routes/                 # Routes Express
│       ├── sockets/                # Messagerie temps réel + signalisation WebRTC
│       └── utils/jwt.js
└── mobile/
    ├── App.js
    ├── index.js
    └── src/
        ├── config.js                # URL de l'API + serveurs ICE
        ├── context/AuthContext.js   # Session utilisateur (token, login/register/logout)
        ├── navigation/AppNavigator.js
        ├── screens/                 # Login, Register, Contacts, Chat, Call
        └── services/                # api.js (REST), socket.js, webrtc.js (CallManager)
```

## Prochaines étapes suggérées

- Ajouter les notifications push pour les appels/messages en arrière-plan
- Ajouter un indicateur "en ligne / hors ligne" et les accusés de lecture
- Ajouter l'envoi d'images/fichiers dans le chat
- Migrer vers un SFU si vous prévoyez des appels de groupe de plus de 6 personnes
- Ajouter des tests automatisés (Jest côté backend, Detox/Jest côté mobile)
