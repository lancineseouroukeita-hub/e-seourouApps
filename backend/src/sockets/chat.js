const prisma = require('../config/prisma');
const { toPublicUser } = require('../controllers/auth.controller');
const { previewLabel } = require('../controllers/conversation.controller');
const { sendPushToUser } = require('../utils/push');
const { isBlockedBetween } = require('../utils/blocking');
const { roomName } = require('../utils/rooms');
const { aggregateReactions } = require('../utils/reactions');
const { replyPreview: buildReplyPreview } = require('../utils/replyPreview');
const { MAX_ATTACHMENT_BASE64_LENGTH } = require('../utils/limits');

// Applique previewLabel (de conversation.controller.js) telle que définie ici,
// pour garder un affichage identique à celui de l'historique REST.
function replyPreview(replyTo) {
  return buildReplyPreview(replyTo, previewLabel);
}

// Longueur max du texte d'un message : rien ne la limitait côté serveur
// jusqu'ici (seule la taille des pièces jointes l'était), ce qui permettait
// d'envoyer plusieurs Mo de texte dans un seul message (jusqu'à la limite
// technique de maxHttpBufferSize de Socket.io). 20 000 caractères est déjà
// largement au-delà de tout message réel.
const MAX_MESSAGE_LENGTH = 20000;

// Fenêtre pendant laquelle un message texte reste modifiable après son envoi
// (comme WhatsApp, qui limite aussi l'édition dans le temps).
const EDIT_WINDOW_MS = 15 * 60 * 1000;
// Nombre max de messages épinglés simultanément par conversation (comme WhatsApp).
const MAX_PINNED_PER_CONVERSATION = 3;

// Anti-doublon pour l'envoi de messages : sur une coupure réseau furtive
// (wifi/4G instable), le client peut ré-émettre le même "message:send" une
// fois reconnecté (tampon interne de Socket.io) avant même d'avoir reçu
// l'accusé de réception du premier envoi — ce qui créait plusieurs messages
// identiques d'affilée. Le client fournit un "clientMsgId" unique par tentative
// d'envoi (le même pour tous les essais d'un même message) ; on retient le
// résultat du premier envoi réussi et on le renvoie tel quel aux tentatives
// suivantes, sans recréer ni rediffuser le message. Nettoyage automatique
// après 60s (largement plus que le temps d'une reconnexion).
const recentSends = new Map(); // clientMsgId -> { payload, ts }
function getRecentSend(clientMsgId) {
  if (!clientMsgId) return null;
  const now = Date.now();
  for (const [key, entry] of recentSends) {
    if (now - entry.ts > 60000) recentSends.delete(key);
  }
  return recentSends.get(clientMsgId) || null;
}
function rememberSend(clientMsgId, payload) {
  if (!clientMsgId) return;
  recentSends.set(clientMsgId, { payload, ts: Date.now() });
}

/**
 * Attache les gestionnaires d'événements liés à la messagerie texte sur un socket déjà authentifié.
 * L'utilisateur rejoint automatiquement une "room" par conversation pour recevoir les nouveaux messages.
 */
function registerChatHandlers(io, socket) {
  const userId = socket.user.id;

  // Rejoint les rooms de toutes les conversations de l'utilisateur au moment de la connexion.
  (async () => {
    const participations = await prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    participations.forEach((p) => socket.join(roomName(p.conversationId)));
  })();

  // Permet de rejoindre la room d'une conversation nouvellement créée sans reconnecter le socket.
  socket.on('conversation:join', ({ conversationId }) => {
    if (conversationId) socket.join(roomName(conversationId));
  });

  socket.on('message:send', async ({ conversationId, content, attachment, replyToId, clientMsgId }, callback) => {
    try {
      // Cette tentative d'envoi a déjà réussi une fois (voir commentaire plus
      // haut sur recentSends) : on renvoie le même résultat sans recréer ni
      // rediffuser de message.
      const existing = getRecentSend(clientMsgId);
      if (existing) return callback && callback({ message: existing.payload });

      const trimmedContent = (content || '').trim();
      const hasAttachment = attachment && attachment.data;

      if (!conversationId || (!trimmedContent && !hasAttachment)) {
        return callback && callback({ error: 'conversationId et un contenu (texte ou pièce jointe) sont requis.' });
      }
      if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        return callback && callback({ error: 'Message trop long (20 000 caractères maximum).' });
      }

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      // Discussion 1-à-1 avec un utilisateur bloqué (par moi ou par lui) : on
      // bloque l'envoi dans les deux sens (Paramètres → Confidentialité).
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { select: { userId: true } } },
      });
      if (!conv) return callback && callback({ error: 'Conversation introuvable.' });
      if (!conv.isGroup) {
        const other = conv.participants.find((p) => p.userId !== userId);
        if (other && await isBlockedBetween(userId, other.userId)) {
          return callback && callback({ error: 'Impossible d\'envoyer ce message : utilisateur bloqué.' });
        }
      }

      // Groupe d'annonces d'une Communauté : seuls les admins de la communauté
      // peuvent y écrire (comme le groupe d'annonces des Communautés WhatsApp).
      if (conv.isAnnouncement && conv.communityId) {
        const membership = await prisma.communityMember.findUnique({
          where: { communityId_userId: { communityId: conv.communityId, userId } },
        });
        if (!membership || membership.role !== 'admin') {
          return callback && callback({ error: 'Seuls les admins de la communauté peuvent écrire dans ce groupe d\'annonces.' });
        }
      }

      // Réponse citée (comme WhatsApp) : on vérifie que le message cité existe
      // bien et appartient à la même conversation, sinon on l'ignore silencieusement
      // plutôt que de faire échouer tout l'envoi pour une histoire de citation.
      let validReplyToId = null;
      if (replyToId) {
        const original = await prisma.message.findUnique({ where: { id: replyToId } });
        if (original && original.conversationId === conversationId) {
          validReplyToId = original.id;
        }
      }

      let data = {
        conversationId,
        senderId: userId,
        content: trimmedContent,
        replyToId: validReplyToId,
      };

      if (hasAttachment) {
        // Garde-fou côté serveur : même si le client limite déjà la taille des
        // fichiers, on revérifie ici (le champ "data" est la chaîne base64).
        if (attachment.data.length > MAX_ATTACHMENT_BASE64_LENGTH) {
          return callback && callback({ error: 'Fichier trop volumineux (5 Mo maximum).' });
        }
        const type = ['image', 'voice', 'file'].includes(attachment.type) ? attachment.type : 'file';
        data = {
          ...data,
          type,
          attachmentData: attachment.data,
          attachmentMime: attachment.mime || 'application/octet-stream',
          attachmentName: attachment.name || null,
          attachmentSize: Number.isFinite(attachment.size) ? attachment.size : null,
          duration: Number.isFinite(attachment.duration) ? attachment.duration : null,
        };
      }

      const message = await prisma.message.create({
        data,
        include: { sender: true, replyTo: { include: { sender: true } } },
      });

      const payload = {
        id: message.id,
        conversationId,
        content: message.content,
        type: message.type,
        deleted: false,
        attachment: hasAttachment ? {
          data: message.attachmentData,
          mime: message.attachmentMime,
          name: message.attachmentName,
          size: message.attachmentSize,
          duration: message.duration,
        } : null,
        createdAt: message.createdAt,
        sender: toPublicUser(message.sender),
        replyTo: replyPreview(message.replyTo),
        reactions: [],
        edited: false,
        editedAt: null,
        pinned: false,
        pinnedAt: null,
        forwarded: false,
      };

      rememberSend(clientMsgId, payload);
      io.to(roomName(conversationId)).emit('message:new', payload);
      callback && callback({ message: payload });

      // Notification push : prévient les autres participants même si l'app est
      // fermée (le socket ci-dessus ne touche que ceux qui ont l'app ouverte).
      // Ne doit jamais faire échouer l'envoi du message si ça plante.
      notifyNewMessage(conversationId, userId, message).catch((err) => {
        console.error('push notify (message) error:', err);
      });
    } catch (err) {
      console.error('message:send error:', err);
      callback && callback({ error: 'Erreur serveur lors de l\'envoi du message.' });
    }
  });

  // Réaction emoji sur un message (comme WhatsApp) : appuyer à nouveau sur la
  // même réaction la retire (toggle), en poser une autre remplace la précédente
  // (une seule réaction par utilisateur et par message, cf. @@unique en base).
  socket.on('message:react', async ({ messageId, emoji }, callback) => {
    try {
      if (!messageId || !emoji || typeof emoji !== 'string' || emoji.length > 8) {
        return callback && callback({ error: 'messageId et emoji (valide) sont requis.' });
      }

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      // Un message supprimé (douce ou définitive) n'a plus rien à afficher : pas
      // de raison d'accumuler des réactions sur une bulle "Message supprimé".
      if (message.deleted) return callback && callback({ error: 'Impossible de réagir à un message supprimé.' });

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      const conv = await prisma.conversation.findUnique({
        where: { id: message.conversationId },
        include: { participants: { select: { userId: true } } },
      });
      // Conversation déjà supprimée entre-temps (cas limite rare) : même garde
      // que message:send, pour éviter un plantage sur "conv.isGroup" si conv est null.
      if (!conv) return callback && callback({ error: 'Conversation introuvable.' });
      if (!conv.isGroup) {
        const other = conv.participants.find((p) => p.userId !== userId);
        if (other && await isBlockedBetween(userId, other.userId)) {
          return callback && callback({ error: 'Impossible de réagir : utilisateur bloqué.' });
        }
      }

      const existing = await prisma.messageReaction.findUnique({
        where: { messageId_userId: { messageId, userId } },
      });

      if (existing && existing.emoji === emoji) {
        await prisma.messageReaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.messageReaction.upsert({
          where: { messageId_userId: { messageId, userId } },
          update: { emoji },
          create: { messageId, userId, emoji },
        });
      }

      const reactions = await prisma.messageReaction.findMany({ where: { messageId } });
      const aggregated = aggregateReactions(reactions);

      io.to(roomName(message.conversationId)).emit('message:reaction', {
        conversationId: message.conversationId,
        messageId,
        reactions: aggregated,
      });
      callback && callback({ ok: true, reactions: aggregated });
    } catch (err) {
      console.error('message:react error:', err);
      callback && callback({ error: 'Erreur serveur lors de la réaction au message.' });
    }
  });

  // Édition d'un message déjà envoyé (comme WhatsApp) : seul l'auteur peut
  // modifier, uniquement un message texte (pas de pièce jointe), pas encore
  // supprimé, et dans la fenêtre de temps autorisée (EDIT_WINDOW_MS).
  socket.on('message:edit', async ({ messageId, content }, callback) => {
    try {
      const trimmedContent = (content || '').trim();
      if (!messageId || !trimmedContent) {
        return callback && callback({ error: 'messageId et un nouveau contenu sont requis.' });
      }
      if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        return callback && callback({ error: 'Message trop long (20 000 caractères maximum).' });
      }

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      if (message.senderId !== userId) {
        return callback && callback({ error: 'Vous ne pouvez modifier que vos propres messages.' });
      }
      if (message.deleted) {
        return callback && callback({ error: 'Impossible de modifier un message supprimé.' });
      }
      if (message.type !== 'text') {
        return callback && callback({ error: 'Seuls les messages texte peuvent être modifiés.' });
      }
      if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
        return callback && callback({ error: 'Ce message ne peut plus être modifié (délai de 15 minutes dépassé).' });
      }

      const editedAt = new Date();
      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { content: trimmedContent, edited: true, editedAt },
      });

      io.to(roomName(message.conversationId)).emit('message:edited', {
        conversationId: message.conversationId,
        messageId,
        content: updated.content,
        editedAt,
      });
      callback && callback({ ok: true, content: updated.content, editedAt });
    } catch (err) {
      console.error('message:edit error:', err);
      callback && callback({ error: 'Erreur serveur lors de la modification du message.' });
    }
  });

  // Épingler/désépingler un message en haut de la discussion (comme WhatsApp).
  // N'importe quel participant peut épingler (pas seulement l'auteur), comme
  // dans un groupe WhatsApp où tout membre peut épingler un message.
  socket.on('message:pin', async ({ messageId, pinned }, callback) => {
    try {
      if (!messageId) return callback && callback({ error: 'messageId requis.' });

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      if (message.deleted) return callback && callback({ error: 'Impossible d\'épingler un message supprimé.' });

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      const shouldPin = pinned !== false;
      if (shouldPin && !message.pinned) {
        const pinnedCount = await prisma.message.count({
          where: { conversationId: message.conversationId, pinned: true },
        });
        if (pinnedCount >= MAX_PINNED_PER_CONVERSATION) {
          return callback && callback({ error: `Vous ne pouvez épingler que ${MAX_PINNED_PER_CONVERSATION} messages maximum par discussion.` });
        }
      }

      const pinnedAt = shouldPin ? new Date() : null;
      await prisma.message.update({
        where: { id: messageId },
        data: { pinned: shouldPin, pinnedAt },
      });

      io.to(roomName(message.conversationId)).emit('message:pinned', {
        conversationId: message.conversationId,
        messageId,
        pinned: shouldPin,
        pinnedAt,
      });
      callback && callback({ ok: true, pinned: shouldPin, pinnedAt });
    } catch (err) {
      console.error('message:pin error:', err);
      callback && callback({ error: 'Erreur serveur lors de l\'épinglage du message.' });
    }
  });

  // Transfert d'un message vers une ou plusieurs autres discussions (comme
  // WhatsApp) : crée une copie indépendante dans chaque discussion cible
  // (pas de lien avec l'original, pour que sa suppression ultérieure n'affecte
  // pas les copies transférées), en respectant les mêmes règles que l'envoi
  // normal (participation requise, blocage, groupe d'annonces).
  socket.on('message:forward', async ({ messageId, conversationIds }, callback) => {
    try {
      if (!messageId || !Array.isArray(conversationIds) || conversationIds.length === 0) {
        return callback && callback({ error: 'messageId et au moins une conversation cible sont requis.' });
      }

      const original = await prisma.message.findUnique({ where: { id: messageId } });
      if (!original || original.deleted) {
        return callback && callback({ error: 'Message introuvable ou supprimé.' });
      }
      const sourceParticipant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: original.conversationId, userId } },
      });
      if (!sourceParticipant) {
        return callback && callback({ error: 'Vous ne participez pas à la discussion d\'origine.' });
      }

      const results = [];
      for (const targetId of conversationIds.slice(0, 20)) { // garde-fou anti-abus
        try {
          const participant = await prisma.conversationParticipant.findUnique({
            where: { conversationId_userId: { conversationId: targetId, userId } },
          });
          if (!participant) {
            results.push({ conversationId: targetId, error: 'Vous ne participez pas à cette discussion.' });
            continue;
          }

          const conv = await prisma.conversation.findUnique({
            where: { id: targetId },
            include: { participants: { select: { userId: true } } },
          });
          if (!conv) {
            results.push({ conversationId: targetId, error: 'Discussion introuvable.' });
            continue;
          }
          if (!conv.isGroup) {
            const other = conv.participants.find((p) => p.userId !== userId);
            if (other && await isBlockedBetween(userId, other.userId)) {
              results.push({ conversationId: targetId, error: 'Utilisateur bloqué.' });
              continue;
            }
          }
          if (conv.isAnnouncement && conv.communityId) {
            const membership = await prisma.communityMember.findUnique({
              where: { communityId_userId: { communityId: conv.communityId, userId } },
            });
            if (!membership || membership.role !== 'admin') {
              results.push({ conversationId: targetId, error: 'Seuls les admins peuvent écrire ici.' });
              continue;
            }
          }

          const copy = await prisma.message.create({
            data: {
              conversationId: targetId,
              senderId: userId,
              content: original.content,
              type: original.type,
              attachmentData: original.attachmentData,
              attachmentMime: original.attachmentMime,
              attachmentName: original.attachmentName,
              attachmentSize: original.attachmentSize,
              duration: original.duration,
              forwarded: true,
            },
            include: { sender: true },
          });

          const payload = {
            id: copy.id,
            conversationId: targetId,
            content: copy.content,
            type: copy.type,
            deleted: false,
            attachment: copy.type !== 'text' ? {
              data: copy.attachmentData,
              mime: copy.attachmentMime,
              name: copy.attachmentName,
              size: copy.attachmentSize,
              duration: copy.duration,
            } : null,
            createdAt: copy.createdAt,
            sender: toPublicUser(copy.sender),
            replyTo: null,
            reactions: [],
            edited: false,
            editedAt: null,
            pinned: false,
            pinnedAt: null,
            forwarded: true,
          };

          io.to(roomName(targetId)).emit('message:new', payload);
          notifyNewMessage(targetId, userId, copy).catch((err) => {
            console.error('push notify (forward) error:', err);
          });
          results.push({ conversationId: targetId, ok: true, message: payload });
        } catch (err) {
          console.error('message:forward (target) error:', err);
          results.push({ conversationId: targetId, error: 'Erreur serveur.' });
        }
      }

      callback && callback({ ok: true, results });
    } catch (err) {
      console.error('message:forward error:', err);
      callback && callback({ error: 'Erreur serveur lors du transfert du message.' });
    }
  });

  socket.on('typing', ({ conversationId, isTyping }) => {
    if (!conversationId) return;
    socket.to(roomName(conversationId)).emit('typing', {
      conversationId,
      userId,
      isTyping: Boolean(isTyping),
    });
  });

  // Suppression d'un message : seul son auteur peut le faire. On garde la ligne
  // en base (suppression "douce") mais on efface le contenu/la pièce jointe, et
  // on prévient tout le monde dans la conversation pour que l'affichage se
  // remplace par "Message supprimé" en direct, des deux côtés.
  // "Supprimer" (menu d'appui long, voir index.html openDeleteMessageDialog) :
  // deux options, comme WhatsApp. forEveryone=false ("pour moi seulement")
  // est proposé sur N'IMPORTE QUEL message (reçu ou envoyé) et ne masque le
  // message que pour la personne qui le demande (MessageHiddenForUser), sans
  // toucher au message lui-même. forEveryone=true ("pour tout le monde")
  // reste réservé à l'auteur du message — sinon n'importe qui pourrait
  // effacer le contenu de n'importe qui chez tout le monde.
  socket.on('message:delete', async ({ messageId, forEveryone }, callback) => {
    try {
      if (!messageId) return callback && callback({ error: 'messageId requis.' });

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });

      if (!forEveryone) {
        await prisma.messageHiddenForUser.upsert({
          where: { messageId_userId: { messageId, userId } },
          update: {},
          create: { messageId, userId },
        });
        return callback && callback({ ok: true });
      }

      if (message.senderId !== userId) {
        return callback && callback({ error: 'Vous ne pouvez supprimer que vos propres messages pour tout le monde.' });
      }

      await prisma.message.update({
        where: { id: messageId },
        data: {
          deleted: true,
          content: '',
          attachmentData: null,
          attachmentMime: null,
          attachmentName: null,
          attachmentSize: null,
          duration: null,
        },
      });

      io.to(roomName(message.conversationId)).emit('message:deleted', {
        conversationId: message.conversationId,
        messageId,
      });
      callback && callback({ ok: true });
    } catch (err) {
      console.error('message:delete error:', err);
      callback && callback({ error: 'Erreur serveur lors de la suppression du message.' });
    }
  });

  // Effacement définitif de la trace "Message supprimé" : contrairement à
  // message:delete (suppression "douce", qui garde la ligne pour l'aperçu de
  // la conversation), ici on supprime réellement la ligne en base. La bulle
  // "🚫 Message supprimé" disparaît alors complètement de la conversation,
  // pour tout le monde, y compris après rechargement de l'historique.
  // Uniquement possible sur un message déjà passé par message:delete, et
  // uniquement par son auteur.
  socket.on('message:erase', async ({ messageId }, callback) => {
    try {
      if (!messageId) return callback && callback({ error: 'messageId requis.' });

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      if (message.senderId !== userId) {
        return callback && callback({ error: 'Vous ne pouvez effacer que vos propres messages.' });
      }
      if (!message.deleted) {
        return callback && callback({ error: 'Supprimez d\'abord ce message avant de l\'effacer définitivement.' });
      }

      await prisma.message.delete({ where: { id: messageId } });

      io.to(roomName(message.conversationId)).emit('message:erased', {
        conversationId: message.conversationId,
        messageId,
      });
      callback && callback({ ok: true });
    } catch (err) {
      console.error('message:erase error:', err);
      callback && callback({ error: 'Erreur serveur lors de l\'effacement du message.' });
    }
  });

  // Marque la conversation comme lue par l'utilisateur courant à cet instant.
  // Sert à afficher les doubles coches (✓✓) sur les messages envoyés par les
  // autres participants dès qu'ils ont ouvert la conversation (comme WhatsApp).
  socket.on('conversation:read', async ({ conversationId }) => {
    if (!conversationId) return;
    try {
      const readAt = new Date();
      await prisma.conversationParticipant.updateMany({
        where: { conversationId, userId },
        data: { lastReadAt: readAt },
      });
      socket.to(roomName(conversationId)).emit('conversation:read-receipt', {
        conversationId,
        userId,
        readAt,
      });
    } catch (err) {
      console.error('conversation:read error:', err);
    }
  });
}

// Envoie une notification push à tous les autres participants de la conversation
// (le service worker décide lui-même de l'afficher ou non si l'app est déjà au premier plan).
async function notifyNewMessage(conversationId, senderId, message) {
  const [sender, others] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId } }),
    // muted: false -> un participant qui a mis CETTE conversation en sourdine
    // ne reçoit pas de notification push pour ses nouveaux messages (voir
    // ConversationParticipant.muted, propre à chaque participant).
    prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: senderId }, muted: false },
      select: { userId: true },
    }),
  ]);
  if (!sender || others.length === 0) return;

  const body = previewLabel(message);
  await Promise.all(others.map((p) => sendPushToUser(p.userId, {
    title: sender.name,
    body,
    tag: 'conversation:' + conversationId,
    data: { type: 'message', conversationId },
  })));
}

module.exports = { registerChatHandlers, roomName };
