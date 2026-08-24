const prisma = require('../config/prisma');
const { MAX_SOUND_BYTES, MAX_SOUND_BASE64_LENGTH } = require('../utils/limits');

const MAX_SOUND_NAME_LENGTH = 80;

// GET /api/sounds — liste légère (SANS le contenu audio, potentiellement
// lourd) pour le sélecteur "Ajouter un son" côté client : le contenu réel
// n'est récupéré qu'à la demande, voir getSound ci-dessous.
async function listSounds(req, res) {
  try {
    const sounds = await prisma.sound.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, duration: true, createdAt: true },
    });
    return res.json({ sounds });
  } catch (err) {
    console.error('listSounds error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// GET /api/sounds/:id — contenu audio complet d'un son de la bibliothèque
// (pour lecture/aperçu), récupéré à la demande plutôt qu'inclus dans la liste
// ou dans chaque publication du fil (un même son est souvent réutilisé par
// plusieurs vidéos — pas la peine de le renvoyer autant de fois).
async function getSound(req, res) {
  try {
    const { id } = req.params;
    const sound = await prisma.sound.findUnique({ where: { id } });
    if (!sound) return res.status(404).json({ error: 'Son introuvable.' });
    return res.json({ sound });
  } catch (err) {
    console.error('getSound error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// POST /api/sounds — réservé aux administrateurs (voir requireAdmin,
// middleware/auth.js) : ajoute un son à la bibliothèque partagée. body:
// { name, audioData (base64, sans le préfixe "data:...;base64,"), audioMime,
//   duration? }
async function createSound(req, res) {
  try {
    const name = String(req.body.name || '').trim().slice(0, MAX_SOUND_NAME_LENGTH);
    const { audioData, audioMime, duration } = req.body;
    if (!name) return res.status(400).json({ error: 'Le nom du son est requis.' });
    if (!audioData || typeof audioData !== 'string') {
      return res.status(400).json({ error: 'audioData est requis.' });
    }
    if (!audioMime || typeof audioMime !== 'string' || !audioMime.startsWith('audio/')) {
      return res.status(400).json({ error: 'audioMime doit être un type audio valide.' });
    }
    if (audioData.length > MAX_SOUND_BASE64_LENGTH) {
      return res.status(400).json({ error: `Son trop volumineux (${Math.round(MAX_SOUND_BYTES / (1024 * 1024))} Mo maximum).` });
    }

    const sound = await prisma.sound.create({
      data: {
        name,
        audioData,
        audioMime,
        duration: Number.isFinite(duration) ? Math.round(duration) : null,
        addedById: req.user.id,
      },
      select: { id: true, name: true, duration: true, createdAt: true },
    });
    return res.status(201).json({ sound });
  } catch (err) {
    console.error('createSound error:', err);
    return res.status(500).json({ error: "Erreur serveur lors de l'ajout du son." });
  }
}

// DELETE /api/sounds/:id — réservé aux administrateurs. Les vidéos qui
// utilisaient ce son gardent simplement leur soundId remis à null (voir
// schema.prisma, onDelete: SetNull) plutôt que d'être supprimées avec lui.
async function deleteSound(req, res) {
  try {
    const { id } = req.params;
    const result = await prisma.sound.deleteMany({ where: { id } });
    if (result.count === 0) return res.status(404).json({ error: 'Son introuvable.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('deleteSound error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression du son.' });
  }
}

module.exports = { listSounds, getSound, createSound, deleteSound };
