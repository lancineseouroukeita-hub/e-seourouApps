// Limites partagées entre plusieurs contrôleurs/gestionnaires socket — centralisées
// ici pour éviter que deux copies de la même constante (chat.js et
// status.controller.js avant ce refactor) ne finissent par diverger silencieusement
// si l'une est modifiée sans l'autre.

// Taille max d'un fichier joint à un message (avant encodage) : 5 Mo. Une fois
// encodé en base64, une chaîne grossit d'environ 33% (4 caractères pour 3
// octets), d'où la marge appliquée par MAX_ATTACHMENT_BASE64_LENGTH.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024;

// Taille max d'une vidéo "Clips" (avant encodage) : 25 Mo (relevé depuis 12
// Mo — trop juste à l'usage, voir la discussion avec Lancine). Volontairement
// limité (voir schema.prisma, modèle Video) — stockée en base64 en base,
// comme les pièces jointes de message, ce qui ne tient pas à grande échelle
// pour des fichiers plus lourds. Combiné à une durée maximale imposée côté
// client (60 secondes, voir public/videos.html), ça garde des fichiers
// raisonnables pour une vidéo courte compressée.
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BASE64_LENGTH = Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 1024;

// Taille max d'une photo "Clips" (avant encodage) : 12 Mo (relevé depuis 8
// Mo, même raison que MAX_VIDEO_BYTES) — une publication "Clips" peut être
// une photo au lieu d'une vidéo courte (voir video.controller.js,
// schema.prisma modèle Video, champ "type").
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_PHOTO_BASE64_LENGTH = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 1024;

// Taille max d'un son "Clips" (avant encodage) : 8 Mo, largement suffisant
// pour un morceau court compressé (voir schema.prisma, modèle Sound et champ
// Video.personalSoundData) — que ce soit un son de la bibliothèque partagée
// (ajouté par un administrateur) ou un son personnel importé par l'auteur
// pour sa propre publication.
const MAX_SOUND_BYTES = 8 * 1024 * 1024;
const MAX_SOUND_BASE64_LENGTH = Math.ceil((MAX_SOUND_BYTES * 4) / 3) + 1024;

// "Solde" (crédits internes, PAS de l'argent réel — voir schema.prisma,
// User.creditsBalance/CreditTransaction) : combien on gagne quand quelqu'un
// interagit avec l'une de mes vidéos/mon compte, et combien coûte
// "Promouvoir" une publication (voir video.controller.js, boostVideo).
const CREDITS_PER_LIKE_RECEIVED = 1;
const CREDITS_PER_FOLLOWER_GAINED = 3;
const BOOST_COST_CREDITS = 50;
const BOOST_DURATION_HOURS = 24;

module.exports = {
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BASE64_LENGTH,
  MAX_VIDEO_BYTES, MAX_VIDEO_BASE64_LENGTH,
  MAX_PHOTO_BYTES, MAX_PHOTO_BASE64_LENGTH,
  MAX_SOUND_BYTES, MAX_SOUND_BASE64_LENGTH,
  CREDITS_PER_LIKE_RECEIVED, CREDITS_PER_FOLLOWER_GAINED,
  BOOST_COST_CREDITS, BOOST_DURATION_HOURS,
};
