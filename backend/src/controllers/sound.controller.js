const prisma = require('../config/prisma');
const { MAX_SOUND_BYTES, MAX_SOUND_BASE64_LENGTH } = require('../utils/limits');

const MAX_SOUND_NAME_LENGTH = 80;

// ---------- Musiques en ligne (recherche + extraits 30s, demande de Lancine)
// ----------
// Choix DÉLIBÉRÉ et discuté avec Lancine (comme le vrai TikTok a de vrais
// contrats de licence avec les maisons de disques pour ses musiques
// populaires, ce qu'on n'a évidemment pas ici) : plutôt que d'héberger des
// chansons sous droits d'auteur, on utilise l'API publique de recherche
// iTunes (https://itunes.apple.com/search), gratuite, sans clé, qui renvoie
// pour chaque titre un extrait de 30 secondes ("previewUrl") — ce sont ces
// extraits, pas les morceaux complets, qui sont proposés ici. Lancine a été
// informée que ça reste une zone plus grise légalement pour un usage dans
// des publications publiques (contrairement à la recherche/l'achat, l'usage
// pour lequel Apple fournit normalement ces extraits) et l'a acceptée en
// connaissance de cause.
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
// Domaines réels observés pour les extraits iTunes — sert de liste blanche
// dans fetchOnlinePreview ci-dessous : cette route télécharge une URL
// FOURNIE PAR LE CLIENT, donc sans cette vérification n'importe qui de
// connecté pourrait s'en servir pour faire faire au serveur une requête vers
// une adresse arbitraire de son choix (SSRF) — y compris une adresse interne
// (ex: métadonnées du serveur cloud). On ne fait confiance qu'à ce qui vient
// vraiment des serveurs Apple.
const ALLOWED_PREVIEW_HOST_SUFFIXES = ['.mzstatic.com', '.apple.com'];

function isAllowedPreviewUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_PREVIEW_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// GET /api/sounds/search-online?q=... — recherche de titres via l'API
// publique iTunes (voir plus haut). Renvoie juste les métadonnées + l'URL de
// l'extrait de 30s ; le contenu audio lui-même n'est téléchargé (et converti
// en base64) qu'au moment où la personne choisit VRAIMENT un titre (voir
// fetchOnlinePreview ci-dessous) — pas la peine de télécharger 15 extraits à
// chaque recherche alors qu'un seul sera peut-être utilisé.
async function searchOnlineMusic(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Paramètre "q" requis.' });

    const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=15`;
    let apiRes;
    try {
      apiRes = await fetch(url);
    } catch (err) {
      console.error('searchOnlineMusic (appel iTunes) échoué :', err);
      return res.status(502).json({ error: 'Recherche de musique indisponible pour le moment.' });
    }
    if (!apiRes.ok) {
      return res.status(502).json({ error: 'Recherche de musique indisponible pour le moment.' });
    }
    const data = await apiRes.json();
    const results = (data.results || [])
      // Certains titres n'ont pas d'extrait disponible (retiré du catalogue,
      // restriction régionale...) — inutile de les proposer.
      .filter((r) => r.previewUrl && isAllowedPreviewUrl(r.previewUrl))
      .map((r) => ({
        trackId: r.trackId,
        trackName: r.trackName || 'Titre inconnu',
        artistName: r.artistName || 'Artiste inconnu',
        artworkUrl: r.artworkUrl100 || r.artworkUrl60 || null,
        previewUrl: r.previewUrl,
      }));
    return res.json({ results });
  } catch (err) {
    console.error('searchOnlineMusic error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// POST /api/sounds/online-preview — télécharge CÔTÉ SERVEUR l'extrait 30s
// choisi et le renvoie en base64, prêt à être utilisé exactement comme un
// son personnel importé (voir videos.html, pendingSoundChoice et
// video.controller.js, createVideo — aucun changement nécessaire là-bas,
// cette route lui fournit juste les mêmes données qu'un fichier importé
// depuis le téléphone). Téléchargé ici plutôt que directement par le
// navigateur : évite tout souci de CORS sur le CDN d'Apple, et permet de
// vérifier la provenance (voir isAllowedPreviewUrl) et la taille avant de
// faire confiance au contenu.
async function fetchOnlinePreview(req, res) {
  try {
    const { previewUrl, trackName, artistName } = req.body;
    if (!previewUrl || typeof previewUrl !== 'string' || !isAllowedPreviewUrl(previewUrl)) {
      return res.status(400).json({ error: 'Source audio invalide.' });
    }

    let audioRes;
    try {
      audioRes = await fetch(previewUrl);
    } catch (err) {
      console.error('fetchOnlinePreview (téléchargement) échoué :', err);
      return res.status(502).json({ error: 'Téléchargement de l\'extrait échoué.' });
    }
    if (!audioRes.ok) {
      return res.status(502).json({ error: 'Téléchargement de l\'extrait échoué.' });
    }
    // Vérifié dès l'en-tête quand il est présent (évite de télécharger
    // inutilement un fichier trop gros), ET après coup sur la taille réelle
    // (un en-tête Content-Length absent ou mensonger ne doit pas permettre
    // de contourner la limite) — un extrait de 30 secondes fait normalement
    // moins d'1 Mo, largement sous MAX_SOUND_BYTES (25 Mo).
    const declaredLength = Number(audioRes.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > MAX_SOUND_BYTES) {
      return res.status(400).json({ error: `Extrait trop volumineux (${Math.round(MAX_SOUND_BYTES / (1024 * 1024))} Mo maximum).` });
    }
    const arrayBuffer = await audioRes.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_SOUND_BYTES) {
      return res.status(400).json({ error: `Extrait trop volumineux (${Math.round(MAX_SOUND_BYTES / (1024 * 1024))} Mo maximum).` });
    }

    const audioData = Buffer.from(arrayBuffer).toString('base64');
    const audioMime = audioRes.headers.get('content-type') || 'audio/mp4';
    const name = `${String(trackName || 'Titre').trim()} - ${String(artistName || '').trim()}`
      .replace(/ - $/, '')
      .slice(0, MAX_SOUND_NAME_LENGTH);

    return res.json({ audioData, audioMime, name });
  } catch (err) {
    console.error('fetchOnlinePreview error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

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

module.exports = { listSounds, getSound, createSound, deleteSound, searchOnlineMusic, fetchOnlinePreview };
