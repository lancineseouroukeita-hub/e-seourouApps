// Limites partagées entre plusieurs contrôleurs/gestionnaires socket — centralisées
// ici pour éviter que deux copies de la même constante (chat.js et
// status.controller.js avant ce refactor) ne finissent par diverger silencieusement
// si l'une est modifiée sans l'autre.

// Taille max d'un fichier joint à un message (avant encodage) : 5 Mo. Une fois
// encodé en base64, une chaîne grossit d'environ 33% (4 caractères pour 3
// octets), d'où la marge appliquée par MAX_ATTACHMENT_BASE64_LENGTH.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024;

module.exports = { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BASE64_LENGTH };
