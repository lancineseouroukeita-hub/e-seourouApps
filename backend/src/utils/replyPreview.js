// Construit l'aperçu du message cité (réponse, comme WhatsApp) inclus dans le
// message qui y répond : juste assez d'infos pour afficher un petit encart
// au-dessus de la bulle, sans avoir à recharger le message d'origine
// séparément. Utilisé à la fois en temps réel (sockets/chat.js, message qui
// vient d'être envoyé) et dans l'historique REST (conversation.controller.js,
// getMessages) — centralisé ici pour que les deux affichages restent identiques.
//
// `previewLabel` est injecté en paramètre plutôt qu'importé directement pour
// éviter un require circulaire entre chat.js et conversation.controller.js
// (qui s'importent déjà mutuellement pour d'autres raisons).
function replyPreview(replyTo, previewLabel) {
  if (!replyTo) return null;
  return {
    id: replyTo.id,
    senderName: replyTo.sender ? replyTo.sender.name : '',
    content: previewLabel(replyTo),
    deleted: replyTo.deleted,
  };
}

module.exports = { replyPreview };
