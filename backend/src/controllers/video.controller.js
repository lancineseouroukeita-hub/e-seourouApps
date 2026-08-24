const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');
const { MAX_VIDEO_BYTES, MAX_VIDEO_BASE64_LENGTH } = require('../utils/limits');

// Nombre de vidéos renvoyées par page du fil (voir listVideos) : assez pour
// remplir l'écran sans recharger une page trop lourde d'un coup — chaque
// entrée peut peser plusieurs Mo une fois son contenu vidéo inclus.
const FEED_PAGE_SIZE = 6;

// Taille max de la légende (comme les autres champs texte courts de l'appli).
const MAX_CAPTION_LENGTH = 300;

function serializeVideo(video, currentUserId) {
  return {
    id: video.id,
    caption: video.caption || null,
    videoData: video.videoData,
    videoMime: video.videoMime,
    thumbnailData: video.thumbnailData || null,
    thumbnailMime: video.thumbnailMime || null,
    duration: video.duration || null,
    createdAt: video.createdAt,
    author: toPublicUser(video.author),
    likesCount: video._count ? video._count.likes : (video.likes ? video.likes.length : 0),
    likedByMe: currentUserId ? video.likes.some((l) => l.userId === currentUserId) : false,
  };
}

// GET /api/videos?before=<createdAt ISO> — fil chronologique (plus récent en
// premier), paginé par curseur plutôt que par numéro de page : plus simple à
// tenir cohérent si une vidéo est publiée pendant qu'on fait défiler. On
// n'inclut que les likes de l'utilisateur courant (pas toute la liste) pour
// savoir s'il a déjà aimé chaque vidéo, sans alourdir la réponse.
async function listVideos(req, res) {
  const { before } = req.query;
  const where = before ? { createdAt: { lt: new Date(before) } } : {};

  const videos = await prisma.video.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: FEED_PAGE_SIZE,
    include: {
      author: true,
      likes: { where: { userId: req.user.id } },
      _count: { select: { likes: true } },
    },
  });

  return res.json({
    videos: videos.map((v) => serializeVideo(v, req.user.id)),
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
    include: {
      author: true,
      likes: { where: { userId: req.user.id } },
      _count: { select: { likes: true } },
    },
  });
  return res.json({ videos: videos.map((v) => serializeVideo(v, req.user.id)) });
}

// POST /api/videos — publie une vidéo. body: { videoData (base64, sans le
// préfixe "data:...;base64,"), videoMime, caption?, duration?, thumbnailData?, thumbnailMime? }
async function createVideo(req, res) {
  try {
    const { videoData, videoMime, duration, thumbnailData, thumbnailMime } = req.body;
    const caption = String(req.body.caption || '').trim().slice(0, MAX_CAPTION_LENGTH) || null;

    if (!videoData || typeof videoData !== 'string') {
      return res.status(400).json({ error: 'videoData est requis.' });
    }
    if (!videoMime || typeof videoMime !== 'string' || !videoMime.startsWith('video/')) {
      return res.status(400).json({ error: 'videoMime doit être un type vidéo valide.' });
    }
    if (videoData.length > MAX_VIDEO_BASE64_LENGTH) {
      return res.status(400).json({ error: `Vidéo trop volumineuse (${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} Mo maximum).` });
    }

    const video = await prisma.video.create({
      data: {
        authorId: req.user.id,
        caption,
        videoData,
        videoMime,
        duration: Number.isFinite(duration) ? Math.round(duration) : null,
        thumbnailData: (thumbnailData && typeof thumbnailData === 'string') ? thumbnailData : null,
        thumbnailMime: (thumbnailMime && typeof thumbnailMime === 'string') ? thumbnailMime : null,
      },
      include: { author: true, likes: true },
    });

    return res.status(201).json({ video: serializeVideo(video, req.user.id) });
  } catch (err) {
    console.error('createVideo error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la publication de la vidéo.' });
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
    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });

    await prisma.videoLike.upsert({
      where: { videoId_userId: { videoId: id, userId: req.user.id } },
      update: {},
      create: { videoId: id, userId: req.user.id },
    });
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

module.exports = { listVideos, listMyVideos, createVideo, deleteVideo, likeVideo, unlikeVideo };
