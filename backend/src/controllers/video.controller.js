const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');
const { awardCredits } = require('./wallet.controller');
const {
  MAX_VIDEO_BYTES, MAX_VIDEO_BASE64_LENGTH, MAX_PHOTO_BYTES, MAX_PHOTO_BASE64_LENGTH,
  MAX_SOUND_BYTES, MAX_SOUND_BASE64_LENGTH,
  CREDITS_PER_LIKE_RECEIVED, BOOST_COST_CREDITS, BOOST_DURATION_HOURS,
} = require('../utils/limits');

// Nombre de vidéos renvoyées par page du fil (voir listVideos) : assez pour
// remplir l'écran sans recharger une page trop lourde d'un coup.
const FEED_PAGE_SIZE = 6;

// Champs de Video à renvoyer pour un LISTING (fil, profil, enregistrées...).
// NOTE : une tentative précédente excluait volontairement "videoData" d'ici
// (chargement différé via une route dédiée) pour réduire le volume transféré
// — REVERTÉE : elle a cassé la lecture des vidéos en production (build v23,
// signalé par Lancine) et je n'ai aucun moyen de tester en conditions
// réelles (pas de navigateur/appareil disponible dans cet environnement) pour
// diagnostiquer la vraie cause en confiance avant de la corriger. On revient
// donc au comportement d'origine (videoData inclus directement dans le
// listing, comme avant) — quitte à retenter cette optimisation plus tard,
// de façon plus prudente et testée. Les autres allègements de requêtes
// (select minimal sur like/save/commentaire/boost, qui ne touchent jamais à
// la diffusion vidéo elle-même) restent en place, eux, sans risque connu.
const VIDEO_LIST_SELECT = {
  id: true,
  authorId: true,
  caption: true,
  type: true,
  videoData: true,
  videoMime: true,
  photoData: true,
  photoMime: true,
  thumbnailData: true,
  thumbnailMime: true,
  duration: true,
  personalSoundData: true,
  personalSoundMime: true,
  personalSoundName: true,
  createdAt: true,
  boostedUntil: true,
  sharesCount: true,
};

// Taille max de la légende (comme les autres champs texte courts de l'appli).
const MAX_CAPTION_LENGTH = 300;
// Taille max d'un commentaire (même idée que MAX_CAPTION_LENGTH).
const MAX_COMMENT_LENGTH = 500;

// Un "boostedUntil" en base peut être dans le passé (voir listVideos, qui les
// nettoie paresseusement à chaque lecture du fil, mais pas forcément dans les
// autres endroits qui appellent serializeVideo, ex: listMyVideos) — jamais
// annoncer une mise en avant expirée comme active au client.
function activeBoostedUntil(video) {
  return (video.boostedUntil && new Date(video.boostedUntil) > new Date()) ? video.boostedUntil : null;
}

// Découpe les 7 derniers jours (aujourd'hui inclus) en compartiments vides
// {date: "YYYY-MM-DD", views: 0, likes: 0} — pour "TikTok Studio" (voir
// getMyStats), rempli ensuite en comptant les événements existants
// (VideoView/VideoLike) plutôt qu'un système d'analytique séparé.
function buildLast7DaysBuckets() {
  const buckets = [];
  const today = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ date: d.toISOString().slice(0, 10), views: 0, likes: 0 });
  }
  return buckets;
}
function bumpBucket(buckets, createdAt, field) {
  const key = new Date(createdAt).toISOString().slice(0, 10);
  const bucket = buckets.find((b) => b.date === key);
  if (bucket) bucket[field] += 1;
}

function serializeVideo(video, currentUserId, followingSet) {
  return {
    id: video.id,
    caption: video.caption || null,
    // "video" (par défaut, y compris les publications créées avant l'ajout
    // des photos) ou "photo" — voir schema.prisma, modèle Video.
    type: video.type || 'video',
    // videoData renvoyé directement ici (voir VIDEO_LIST_SELECT plus haut) —
    // une tentative précédente le chargeait à la demande via une route dédiée
    // (GET /api/videos/:id/media) pour réduire le volume transféré, mais ça a
    // cassé la lecture des vidéos en production (build v23, signalé par
    // Lancine) et je n'ai pas pu diagnostiquer la vraie cause sans navigateur
    // pour tester en conditions réelles. Retour au comportement d'origine.
    videoData: video.videoData || null,
    videoMime: video.videoMime || null,
    photoData: video.photoData || null,
    photoMime: video.photoMime || null,
    thumbnailData: video.thumbnailData || null,
    thumbnailMime: video.thumbnailMime || null,
    duration: video.duration || null,
    // Son ajouté à la publication ("Ajouter un son") — au plus un des deux :
    // soit un son de la bibliothèque partagée (juste id/nom ici ; le contenu
    // audio se récupère à la demande via GET /api/sounds/:id, voir
    // sound.controller.js et videos.html, getSoundBlobUrl), soit un son
    // personnel propre à cette publication (contenu inclus directement,
    // comme videoData). Ni l'un ni l'autre : la vidéo garde sa bande son
    // d'origine, comme avant cette fonctionnalité.
    sound: video.sound ? { id: video.sound.id, name: video.sound.name } : null,
    personalSoundData: video.personalSoundData || null,
    personalSoundMime: video.personalSoundMime || null,
    personalSoundName: video.personalSoundName || null,
    createdAt: video.createdAt,
    author: toPublicUser(video.author),
    likesCount: video._count ? video._count.likes : (video.likes ? video.likes.length : 0),
    likedByMe: currentUserId ? video.likes.some((l) => l.userId === currentUserId) : false,
    // saves/comments ne sont inclus que là où on en a besoin (voir listVideos,
    // listMyVideos) — absents ailleurs (ex: juste après createVideo), d'où les
    // valeurs par défaut (une publication qu'on vient de créer n'est encore ni
    // enregistrée ni commentée par personne).
    savedByMe: (currentUserId && video.saves) ? video.saves.some((s) => s.userId === currentUserId) : false,
    savesCount: video._count ? (video._count.saves || 0) : (video.saves ? video.saves.length : 0),
    commentsCount: video._count ? (video._count.comments || 0) : (video.comments ? video.comments.length : 0),
    // Vrai si je suis déjà l'auteur (voir schema.prisma, modèle Follow) — sert
    // à afficher ou masquer le badge "+" de suivi rapide sur son avatar dans
    // le fil, comme TikTok (le badge disparaît une fois qu'on suit).
    followedByAuthor: followingSet ? followingSet.has(video.authorId) : false,
    // "Promouvoir" (menu ☰) — voir boostVideo plus bas. Null si jamais
    // boostée ou si la mise en avant a expiré.
    boostedUntil: activeBoostedUntil(video),
    viewsCount: video._count ? (video._count.views || 0) : (video.views ? video.views.length : 0),
    // Icône flèche du fil (comme TikTok, voir videos.html/recordShare) —
    // simple colonne dénormalisée sur Video, pas une relation à compter ici.
    sharesCount: video.sharesCount || 0,
  };
}

// GET /api/videos?before=<createdAt ISO>&onlyFollowing=1 — fil chronologique
// (plus récent en premier), paginé par curseur plutôt que par numéro de page :
// plus simple à tenir cohérent si une vidéo est publiée pendant qu'on fait
// défiler. On n'inclut que les likes de l'utilisateur courant (pas toute la
// liste) pour savoir s'il a déjà aimé chaque vidéo, sans alourdir la réponse.
// onlyFollowing=1 restreint aux publications des comptes que je suis (onglet
// "Suivis", voir schema.prisma modèle Follow) au lieu de tout le monde
// ("Pour toi", comportement par défaut).
async function listVideos(req, res) {
  // Nettoyage paresseux des mises en avant expirées ("Promouvoir", voir
  // boostVideo) à chaque lecture du fil plutôt qu'une tâche planifiée
  // séparée : ça garantit qu'un boostedUntil non-null lu juste après est
  // TOUJOURS actif, ce qui simplifie énormément le tri ci-dessous (pas
  // besoin de comparer des dates dans le ORDER BY).
  await prisma.video.updateMany({
    where: { boostedUntil: { lt: new Date() } },
    data: { boostedUntil: null },
  });

  const { before, onlyFollowing } = req.query;
  const where = {};
  if (before) where.createdAt = { lt: new Date(before) };

  const myFollowing = await prisma.follow.findMany({
    where: { followerId: req.user.id },
    select: { followingId: true },
  });
  const followingIds = myFollowing.map((f) => f.followingId);
  const followingSet = new Set(followingIds);

  if (onlyFollowing === '1' || onlyFollowing === 'true') {
    // "in: []" renvoie bien zéro résultat plutôt que tout le monde — normal
    // quand on ne suit encore personne.
    // includeMine=1 (onglet "Ami(e)s", voir videos.html loadFriendsFeed) :
    // en plus des comptes suivis, inclut MES PROPRES publications — TikTok
    // affiche "mes publications + celles des ami(e)s" sur cet onglet-là,
    // contrairement à "Suivis" (voir videos.html feedTab data-feed=
    // "following") qui reste, lui, restreint aux seuls comptes suivis.
    const { includeMine } = req.query;
    const authorIds = (includeMine === '1' || includeMine === 'true')
      ? [...followingIds, req.user.id]
      : followingIds;
    where.authorId = { in: authorIds };
  } else {
    // Compte "privé" (Paramètres et confidentialité, voir
    // schema.prisma User.videosPrivate) : ses publications ne doivent
    // apparaître dans le "Pour toi" de personne d'autre que ses abonnés (et
    // lui-même) — comme un compte TikTok privé.
    where.OR = [
      { author: { videosPrivate: false } },
      { authorId: { in: [...followingIds, req.user.id] } },
    ];
  }

  const videos = await prisma.video.findMany({
    where,
    // La mise en avant ne fait remonter que la PREMIÈRE page (before absent)
    // — mélanger un tri par boostedUntil avec la pagination par curseur
    // createdAt au-delà de la première page rendrait le curseur incohérent
    // (une vidéo boostée mais ancienne pourrait réapparaître ou disparaître
    // entre deux pages). Sans compter que c'est la première page qui compte
    // le plus pour la visibilité, comme sur TikTok.
    orderBy: before
      ? { createdAt: 'desc' }
      : [{ boostedUntil: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: FEED_PAGE_SIZE,
    // select (pas include) : voir VIDEO_LIST_SELECT plus haut — exclut
    // videoData de la requête SQL elle-même, pas seulement de la réponse.
    select: {
      ...VIDEO_LIST_SELECT,
      author: true,
      sound: { select: { id: true, name: true } },
      likes: { where: { userId: req.user.id } },
      saves: { where: { userId: req.user.id } },
      _count: { select: { likes: true, comments: true, saves: true, views: true } },
    },
  });

  return res.json({
    videos: videos.map((v) => serializeVideo(v, req.user.id, followingSet)),
    nextCursor: videos.length === FEED_PAGE_SIZE ? videos[videos.length - 1].createdAt : null,
  });
}

// GET /api/videos/mine — mes propres vidéos publiées (pour un futur écran
// "mon profil" sur ce produit ; pas encore utilisé côté client mais évite un
// aller-retour supplémentaire à prévoir plus tard).
async function listMyVideos(req, res) {
  const videos = await prisma.video.findMany({
    where: { authorId: req.user.id },
    orderBy: { createdAt: 'desc' },
    // select (pas include) : voir VIDEO_LIST_SELECT plus haut.
    select: {
      ...VIDEO_LIST_SELECT,
      author: true,
      sound: { select: { id: true, name: true } },
      likes: { where: { userId: req.user.id } },
      saves: { where: { userId: req.user.id } },
      _count: { select: { likes: true, comments: true, saves: true, views: true } },
    },
  });
  // Pas besoin de followingSet ici : ce sont mes propres vidéos, le badge
  // "suivre" ne s'affiche jamais sur ses propres publications côté client.
  return res.json({ videos: videos.map((v) => serializeVideo(v, req.user.id)) });
}

// GET /api/videos/saved — mes vidéos/photos enregistrées (bouton
// marque-page) — alimente l'écran "Vidéos hors ligne" (menu ☰), qui propose
// de les télécharger sur l'appareil pour les revoir sans connexion (voir
// videos.html) : pas de vrai stockage "hors-ligne" séparé côté serveur, on
// réutilise simplement les enregistrements existants (VideoSave).
async function listSavedVideos(req, res) {
  try {
    const saves = await prisma.videoSave.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        // select (pas include) sur "video" : voir VIDEO_LIST_SELECT plus haut.
        video: {
          select: {
            ...VIDEO_LIST_SELECT,
            author: true,
            sound: { select: { id: true, name: true } },
            likes: { where: { userId: req.user.id } },
            saves: { where: { userId: req.user.id } },
            _count: { select: { likes: true, comments: true, saves: true, views: true } },
          },
        },
      },
    });
    // Une vidéo enregistrée peut avoir été supprimée depuis par son auteur
    // (voir deleteVideo) : le signet reste alors orphelin (onDelete: Cascade
    // sur VideoSave.videoId le supprimerait normalement, donc ce cas ne
    // devrait pas arriver, mais on filtre par sécurité plutôt que de planter).
    const videos = saves.map((s) => s.video).filter(Boolean);
    return res.json({ videos: videos.map((v) => serializeVideo(v, req.user.id)) });
  } catch (err) {
    console.error('listSavedVideos error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// PATCH /api/videos/settings/privacy — "Paramètres et confidentialité" du
// menu ☰ : body { videosPrivate: boolean }. Ne concerne QUE les publications
// "Clips" (voir schema.prisma, User.videosPrivate) — pas les statuts ni les
// messages de seourouApps, qui ont leurs propres réglages de confidentialité.
async function updateVideoPrivacy(req, res) {
  try {
    const { videosPrivate } = req.body;
    if (typeof videosPrivate !== 'boolean') {
      return res.status(400).json({ error: 'videosPrivate (booléen) est requis.' });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { videosPrivate } });
    return res.json({ ok: true, videosPrivate });
  } catch (err) {
    console.error('updateVideoPrivacy error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// GET /api/videos/settings/privacy — état actuel (pour afficher le bon état
// du bouton "compte privé" à l'ouverture de l'écran Paramètres).
async function getVideoPrivacy(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { videosPrivate: true } });
    return res.json({ videosPrivate: user ? user.videosPrivate : false });
  } catch (err) {
    console.error('getVideoPrivacy error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// GET /api/videos/:id/media — contenu binaire RÉEL d'UNE vidéo (jamais une
// photo : voir isPhoto côté client, qui n'appelle jamais cette route puisque
// photoData reste embarqué directement dans le listing, bien plus léger).
// Séparé de listVideos/listMyVideos/listSavedVideos (voir VIDEO_LIST_SELECT
// plus haut) pour ne transférer le contenu vidéo (jusqu'à ~33 Mo encodé)
// qu'une vidéo à la fois, au moment où le client en a réellement besoin
// (voir videos.html, fetchVideoMedia — appelé quand un clip devient visible,
// pas pour toute une page de résultats d'un coup).
async function getVideoMedia(req, res) {
  try {
    const { id } = req.params;
    const video = await prisma.video.findUnique({
      where: { id },
      select: { id: true, type: true, videoData: true, videoMime: true },
    });
    if (!video || video.type !== 'video' || !video.videoData) {
      return res.status(404).json({ error: 'Vidéo introuvable.' });
    }
    return res.json({ videoData: video.videoData, videoMime: video.videoMime });
  } catch (err) {
    console.error('getVideoMedia error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// POST /api/videos/:id/view — enregistre une "vue" pour les statistiques
// ("TikTok Studio", voir getMyStats) : une ligne par visionnage compté côté
// client (voir videos.html, setupObserver — une seule fois par vidéo par
// session, pas à chaque repassage devant elle en scrollant). Pas d'unicité
// en base contrairement à VideoLike : plusieurs vues dans le temps sont
// justement ce qui permet de tracer une courbe (voir buildLast7DaysBuckets).
async function recordView(req, res) {
  try {
    const { id } = req.params;
    const video = await prisma.video.findUnique({ where: { id }, select: { id: true } });
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });
    await prisma.videoView.create({ data: { videoId: id, viewerId: req.user.id } });
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('recordView error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// POST /api/videos/:id/boost — "Promouvoir" (menu ☰) : dépense
// BOOST_COST_CREDITS crédits "Solde" (voir utils/limits.js) pour faire
// remonter une de MES publications en tête du fil "Pour toi" (voir
// listVideos) pendant BOOST_DURATION_HOURS. Coût fixe plutôt qu'un système
// d'enchères — bien plus simple à comprendre pour un petit groupe de
// testeurs, et ce sont des crédits internes, pas un vrai paiement (voir
// schema.prisma, CreditTransaction).
async function boostVideo(req, res) {
  try {
    const { id } = req.params;
    // select : juste de quoi vérifier la propriété (jusqu'à 80 Mo de
    // videoData sinon renvoyés pour rien, voir VIDEO_LIST_SELECT plus haut).
    const video = await prisma.video.findUnique({ where: { id }, select: { id: true, authorId: true } });
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });
    if (video.authorId !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez promouvoir que vos propres publications.' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { creditsBalance: true } });
    const balance = user ? user.creditsBalance : 0;
    if (balance < BOOST_COST_CREDITS) {
      return res.status(400).json({
        error: `Solde insuffisant : ${BOOST_COST_CREDITS} crédits nécessaires, ${balance} disponible(s). Gagnez des crédits en étant aimé(e)/suivi(e) (voir l'écran Solde).`,
      });
    }
    const boostedUntil = new Date(Date.now() + BOOST_DURATION_HOURS * 60 * 60 * 1000);
    const [, updatedUser] = await prisma.$transaction([
      prisma.creditTransaction.create({
        data: { userId: req.user.id, amount: -BOOST_COST_CREDITS, reason: 'boost_video', relatedVideoId: id },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { creditsBalance: { decrement: BOOST_COST_CREDITS } },
      }),
      // select : le résultat de cette mise à jour n'est même pas utilisé plus
      // bas (voir la déstructuration "[, updatedUser]" ci-dessus) — inutile
      // de faire revenir tout videoData avec, comme ailleurs dans ce fichier.
      prisma.video.update({ where: { id }, data: { boostedUntil }, select: { id: true } }),
    ]);
    return res.json({ ok: true, boostedUntil, balance: updatedUser.creditsBalance });
  } catch (err) {
    console.error('boostVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la mise en avant.' });
  }
}

// GET /api/videos/stats/mine — "TikTok Studio" (menu ☰) : vue d'ensemble de
// mes publications (totaux + courbe des 7 derniers jours + classement par
// vues) calculée à partir des événements déjà enregistrés (VideoView,
// VideoLike) plutôt qu'un système d'analytique séparé.
async function getMyStats(req, res) {
  try {
    const myVideos = await prisma.video.findMany({
      where: { authorId: req.user.id },
      select: {
        id: true, caption: true, type: true, createdAt: true, boostedUntil: true,
        thumbnailData: true, thumbnailMime: true, photoData: true, photoMime: true,
        _count: { select: { likes: true, comments: true, saves: true, views: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const videoIds = myVideos.map((v) => v.id);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [followersCount, sevenDayViews, sevenDayLikes] = await Promise.all([
      prisma.follow.count({ where: { followingId: req.user.id } }),
      videoIds.length
        ? prisma.videoView.findMany({ where: { videoId: { in: videoIds }, createdAt: { gte: sevenDaysAgo } }, select: { createdAt: true } })
        : Promise.resolve([]),
      videoIds.length
        ? prisma.videoLike.findMany({ where: { videoId: { in: videoIds }, createdAt: { gte: sevenDaysAgo } }, select: { createdAt: true } })
        : Promise.resolve([]),
    ]);

    const last7Days = buildLast7DaysBuckets();
    sevenDayViews.forEach((v) => bumpBucket(last7Days, v.createdAt, 'views'));
    sevenDayLikes.forEach((l) => bumpBucket(last7Days, l.createdAt, 'likes'));

    const totalViews = myVideos.reduce((sum, v) => sum + v._count.views, 0);
    const totalLikes = myVideos.reduce((sum, v) => sum + v._count.likes, 0);
    const totalComments = myVideos.reduce((sum, v) => sum + v._count.comments, 0);

    return res.json({
      totalViews,
      totalLikes,
      totalComments,
      followersCount,
      videosCount: myVideos.length,
      last7Days,
      topVideos: [...myVideos]
        .sort((a, b) => b._count.views - a._count.views)
        .slice(0, 10)
        .map((v) => ({
          id: v.id,
          caption: v.caption,
          type: v.type,
          createdAt: v.createdAt,
          boostedUntil: activeBoostedUntil(v),
          viewsCount: v._count.views,
          likesCount: v._count.likes,
          commentsCount: v._count.comments,
          savesCount: v._count.saves,
          thumbnailData: v.type === 'photo' ? null : v.thumbnailData,
          thumbnailMime: v.type === 'photo' ? null : v.thumbnailMime,
          photoData: v.type === 'photo' ? v.photoData : null,
          photoMime: v.type === 'photo' ? v.photoMime : null,
        })),
    });
  } catch (err) {
    console.error('getMyStats error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// POST /api/videos — publie une vidéo OU une photo (comme les
// Stories/Reels : les deux formats sont acceptés sur "Clips"). body:
// { type: "video" (défaut) | "photo", caption?,
//   -- si type === "video" -- videoData (base64, sans le préfixe
//   "data:...;base64,"), videoMime, duration?, thumbnailData?, thumbnailMime?,
//   -- si type === "photo" -- photoData (idem), photoMime }
async function createVideo(req, res) {
  try {
    const type = req.body.type === 'photo' ? 'photo' : 'video';
    const caption = String(req.body.caption || '').trim().slice(0, MAX_CAPTION_LENGTH) || null;

    if (type === 'photo') {
      const { photoData, photoMime } = req.body;
      if (!photoData || typeof photoData !== 'string') {
        return res.status(400).json({ error: 'photoData est requis.' });
      }
      if (!photoMime || typeof photoMime !== 'string' || !photoMime.startsWith('image/')) {
        return res.status(400).json({ error: 'photoMime doit être un type image valide.' });
      }
      if (photoData.length > MAX_PHOTO_BASE64_LENGTH) {
        return res.status(400).json({ error: `Photo trop volumineuse (${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} Mo maximum).` });
      }

      const video = await prisma.video.create({
        data: { authorId: req.user.id, caption, type, photoData, photoMime },
        include: { author: true, likes: true },
      });
      return res.status(201).json({ video: serializeVideo(video, req.user.id) });
    }

    const { videoData, videoMime, duration, thumbnailData, thumbnailMime, soundId, personalSoundData, personalSoundMime, personalSoundName } = req.body;

    if (!videoData || typeof videoData !== 'string') {
      return res.status(400).json({ error: 'videoData est requis.' });
    }
    if (!videoMime || typeof videoMime !== 'string' || !videoMime.startsWith('video/')) {
      return res.status(400).json({ error: 'videoMime doit être un type vidéo valide.' });
    }
    if (videoData.length > MAX_VIDEO_BASE64_LENGTH) {
      return res.status(400).json({ error: `Vidéo trop volumineuse (${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} Mo maximum).` });
    }

    // "Ajouter un son" : au plus une des deux options, jamais les deux à la
    // fois (soundId prioritaire s'il est fourni — voir schema.prisma, modèle
    // Video). Un soundId qui ne correspond à aucun son existant est ignoré
    // silencieusement plutôt que de faire échouer toute la publication.
    let finalSoundId = null;
    let finalPersonalSoundData = null;
    let finalPersonalSoundMime = null;
    let finalPersonalSoundName = null;
    if (soundId && typeof soundId === 'string') {
      // select: juste l'existence du son (jusqu'à 25 Mo d'audioData sinon
      // renvoyés pour rien, voir schema.prisma modèle Sound — même raison que
      // VIDEO_LIST_SELECT plus haut).
      const sound = await prisma.sound.findUnique({ where: { id: soundId }, select: { id: true } });
      if (sound) finalSoundId = sound.id;
    } else if (personalSoundData && typeof personalSoundData === 'string') {
      if (!personalSoundMime || typeof personalSoundMime !== 'string' || !personalSoundMime.startsWith('audio/')) {
        return res.status(400).json({ error: 'personalSoundMime doit être un type audio valide.' });
      }
      if (personalSoundData.length > MAX_SOUND_BASE64_LENGTH) {
        return res.status(400).json({ error: `Son trop volumineux (${Math.round(MAX_SOUND_BYTES / (1024 * 1024))} Mo maximum).` });
      }
      finalPersonalSoundData = personalSoundData;
      finalPersonalSoundMime = personalSoundMime;
      finalPersonalSoundName = (personalSoundName && typeof personalSoundName === 'string') ? personalSoundName.trim().slice(0, 80) : null;
    }

    const video = await prisma.video.create({
      data: {
        authorId: req.user.id,
        caption,
        type,
        videoData,
        videoMime,
        duration: Number.isFinite(duration) ? Math.round(duration) : null,
        thumbnailData: (thumbnailData && typeof thumbnailData === 'string') ? thumbnailData : null,
        thumbnailMime: (thumbnailMime && typeof thumbnailMime === 'string') ? thumbnailMime : null,
        soundId: finalSoundId,
        personalSoundData: finalPersonalSoundData,
        personalSoundMime: finalPersonalSoundMime,
        personalSoundName: finalPersonalSoundName,
      },
      // select (pas include) : évite de faire revenir le videoData tout
      // juste écrit (jusqu'à ~33 Mo une fois encodé) alors que serializeVideo
      // ne le renvoie de toute façon jamais (voir VIDEO_LIST_SELECT plus
      // haut) — le client le récupérera à la demande via GET
      // /api/videos/:id/media dès qu'il affichera ce clip (voir videos.html,
      // fetchVideoMedia).
      select: {
        ...VIDEO_LIST_SELECT,
        author: true,
        sound: { select: { id: true, name: true } },
        likes: true,
      },
    });

    return res.status(201).json({ video: serializeVideo(video, req.user.id) });
  } catch (err) {
    console.error('createVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la publication.' });
  }
}

// DELETE /api/videos/:id — supprime une de mes propres vidéos (jamais celle
// d'un autre auteur).
async function deleteVideo(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.video.deleteMany({ where: { id, authorId: req.user.id } });
    if (result.count === 0) return res.status(404).json({ error: 'Vidéo introuvable.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('deleteVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression de la vidéo.' });
  }
}

// POST /api/videos/:id/like — aime une vidéo (idempotent : aimer deux fois ne
// crée pas deux lignes, comme les réactions sur un message).
async function likeVideo(req, res) {
  try {
    const { id } = req.params;
    // select : voir VIDEO_LIST_SELECT plus haut — seul authorId est vraiment
    // utilisé ci-dessous (jamais besoin du contenu vidéo pour un like).
    const video = await prisma.video.findUnique({ where: { id }, select: { id: true, authorId: true } });
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });

    // Vérifié AVANT le upsert (pas juste "update: {}") pour savoir si ce like
    // est vraiment nouveau — sinon aimer/retirer/ré-aimer la même vidéo en
    // boucle permettrait de gagner des crédits "Solde" à l'infini (voir
    // limits.js, CREDITS_PER_LIKE_RECEIVED).
    const alreadyLiked = await prisma.videoLike.findUnique({
      where: { videoId_userId: { videoId: id, userId: req.user.id } },
    });
    if (!alreadyLiked) {
      await prisma.videoLike.create({ data: { videoId: id, userId: req.user.id } });
      // Jamais de crédits pour soi-même (aimer sa propre vidéo).
      if (video.authorId !== req.user.id) {
        await awardCredits(video.authorId, CREDITS_PER_LIKE_RECEIVED, 'like_recu', id);
      }
    }
    const likesCount = await prisma.videoLike.count({ where: { videoId: id } });
    return res.json({ ok: true, likesCount });
  } catch (err) {
    console.error('likeVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du like.' });
  }
}

// POST /api/videos/:id/unlike
async function unlikeVideo(req, res) {
  try {
    const { id } = req.params;
    await prisma.videoLike.deleteMany({ where: { videoId: id, userId: req.user.id } });
    const likesCount = await prisma.videoLike.count({ where: { videoId: id } });
    return res.json({ ok: true, likesCount });
  } catch (err) {
    console.error('unlikeVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du retrait du like.' });
  }
}

// POST /api/videos/:id/save — "enregistrer" une vidéo (bouton marque-page,
// comme TikTok) : juste un signet personnel, idempotent comme un like.
async function saveVideo(req, res) {
  try {
    const { id } = req.params;
    // select : juste l'existence (voir VIDEO_LIST_SELECT plus haut).
    const video = await prisma.video.findUnique({ where: { id }, select: { id: true } });
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });

    await prisma.videoSave.upsert({
      where: { videoId_userId: { videoId: id, userId: req.user.id } },
      update: {},
      create: { videoId: id, userId: req.user.id },
    });
    const savesCount = await prisma.videoSave.count({ where: { videoId: id } });
    return res.json({ ok: true, savesCount });
  } catch (err) {
    console.error('saveVideo error:', err);
    return res.status(500).json({ error: "Erreur serveur lors de l'enregistrement." });
  }
}

// POST /api/videos/:id/unsave
async function unsaveVideo(req, res) {
  try {
    const { id } = req.params;
    await prisma.videoSave.deleteMany({ where: { videoId: id, userId: req.user.id } });
    const savesCount = await prisma.videoSave.count({ where: { videoId: id } });
    return res.json({ ok: true, savesCount });
  } catch (err) {
    console.error('unsaveVideo error:', err);
    return res.status(500).json({ error: "Erreur serveur lors du retrait de l'enregistrement." });
  }
}

// POST /api/videos/:id/report — "Signaler" (menu d'appui long, comme
// TikTok) : body { reason }. N'empêche jamais la vidéo de rester visible
// (pas de suppression/masquage automatique au premier signalement, trop
// facile à détourner pour faire disparaître le contenu de quelqu'un
// d'autre) — juste une trace en base pour une modération manuelle
// ultérieure (voir schema.prisma, VideoReport). Toujours idempotent côté
// client (le bouton "Signaler" se referme immédiatement, voir videos.html),
// mais volontairement PAS idempotent côté serveur comme un like : la même
// personne peut signaler plusieurs fois la même vidéo sans que ça échoue.
const VALID_REPORT_REASONS = ['contenu_inapproprie', 'spam', 'violence', 'faux_compte', 'autre'];
async function reportVideo(req, res) {
  try {
    const { id } = req.params;
    const video = await prisma.video.findUnique({ where: { id }, select: { id: true } });
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });

    const reason = VALID_REPORT_REASONS.includes(req.body.reason) ? req.body.reason : 'autre';
    await prisma.videoReport.create({ data: { videoId: id, reporterId: req.user.id, reason } });
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('reportVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du signalement.' });
  }
}

// POST /api/videos/:id/share — icône flèche du fil (comme TikTok) : appelé à
// chaque partage RÉEL (copier le lien, WhatsApp, Telegram, Messenger, envoi
// à un contact — voir videos.html, recordShare), jamais juste à l'ouverture
// de la feuille "Envoyer à". Pas idempotent (contrairement à like/save) :
// partager la même vidéo plusieurs fois incrémente à chaque fois, comme un
// vrai compteur de partages.
async function shareVideo(req, res) {
  try {
    const { id } = req.params;
    const video = await prisma.video.update({
      where: { id },
      data: { sharesCount: { increment: 1 } },
      select: { sharesCount: true },
    }).catch(() => null);
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });
    return res.json({ ok: true, sharesCount: video.sharesCount });
  } catch (err) {
    console.error('shareVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// GET /api/videos/:id/comments — liste simple, du plus ancien au plus récent
// (comme une discussion), pas de pagination pour cette première version : le
// volume de commentaires sur "Clips" devrait rester modeste au démarrage.
async function listComments(req, res) {
  try {
    const { id } = req.params;
    const comments = await prisma.videoComment.findMany({
      where: { videoId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: true },
    });
    return res.json({
      comments: comments.map((c) => ({
        id: c.id,
        text: c.text,
        createdAt: c.createdAt,
        author: toPublicUser(c.author),
      })),
    });
  } catch (err) {
    console.error('listComments error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// POST /api/videos/:id/comments — body: { text }
async function createComment(req, res) {
  try {
    const { id } = req.params;
    const text = String(req.body.text || '').trim().slice(0, MAX_COMMENT_LENGTH);
    if (!text) return res.status(400).json({ error: 'Le commentaire ne peut pas être vide.' });

    // select : juste l'existence (voir VIDEO_LIST_SELECT plus haut).
    const video = await prisma.video.findUnique({ where: { id }, select: { id: true } });
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });

    const comment = await prisma.videoComment.create({
      data: { videoId: id, authorId: req.user.id, text },
      include: { author: true },
    });
    const commentsCount = await prisma.videoComment.count({ where: { videoId: id } });
    return res.status(201).json({
      comment: {
        id: comment.id,
        text: comment.text,
        createdAt: comment.createdAt,
        author: toPublicUser(comment.author),
      },
      commentsCount,
    });
  } catch (err) {
    console.error('createComment error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la publication du commentaire.' });
  }
}

module.exports = {
  listVideos, listMyVideos, listSavedVideos, createVideo, deleteVideo, likeVideo, unlikeVideo,
  saveVideo, unsaveVideo, listComments, createComment, reportVideo, shareVideo, getVideoMedia,
  recordView, boostVideo, getMyStats, updateVideoPrivacy, getVideoPrivacy,
};
