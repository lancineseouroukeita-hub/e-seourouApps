// Limites partagées entre plusieurs contrôleurs/gestionnaires socket — centralisées
// ici pour éviter que deux copies de la même constante (chat.js et
// status.controller.js avant ce refactor) ne finissent par diverger silencieusement
// si l'une est modifiée sans l'autre.

// Taille max d'un fichier joint à un message (avant encodage) : 5 Mo. Une fois
// encodé en base64, une chaîne grossit d'environ 33% (4 caractères pour 3
// octets), d'où la marge appliquée par MAX_ATTACHMENT_BASE64_LENGTH.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024;

// Taille max d'une vidéo "Clips" (avant encodage) : 12 Mo. Volontairement
// limité (voir schema.prisma, modèle Video) — stockée en base64 en base,
// comme les pièces jointes de message, ce qui ne tient pas à grande échelle
// pour des fichiers plus lourds. Combiné à une durée maximale imposée côté
// client (30 secondes, voir public/videos.html), ça garde des fichiers
// raisonnables pour une vidéo courte compressée.
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BASE64_LENGTH = Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 1024;

// Taille max d'une photo "Clips" (avant encodage) : 8 Mo — une publication
// "Clips" peut être une photo au lieu d'une vidéo courte (voir
// video.controller.js, schema.prisma modèle Video, champ "type").
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_BASE64_LENGTH = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 1024;

module.exports = {
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BASE64_LENGTH,
  MAX_VIDEO_BYTES, MAX_VIDEO_BASE64_LENGTH,
  MAX_PHOTO_BYTES, MAX_PHOTO_BASE64_LENGTH,
};
