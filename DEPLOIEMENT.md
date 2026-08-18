# Déployer seourouApps en ligne (fini les soucis de réseau local)

Ce guide remplace toute la manip "point d'accès mobile / IP locale". Une fois fait,
vous ouvrez juste une adresse internet normale depuis n'importe quel appareil,
n'importe quel réseau.

Ce qui a changé dans le code (déjà fait) :
- Le serveur backend sert maintenant directement la page web (plus besoin de lancer
  `npx serve` à côté — un seul service tourne, sur un seul port).
- La page web est devenue une PWA installable (icône, manifest, mode hors-ligne pour
  l'écran de connexion).
- L'URL de l'API se règle automatiquement sur l'adresse depuis laquelle la page est
  chargée — plus besoin de la taper à la main.

## Étape 0 — Vérifier que ça marche toujours en local

```bash
cd backend
npm run dev
```

Ouvrez `http://localhost:4000` dans le navigateur : vous devez voir l'écran de
connexion du testeur (au lieu de juste `{"status":"ok"}`). Testez une connexion avec
un compte existant pour confirmer que rien n'est cassé.

## Étape 1 — Créer une base PostgreSQL gratuite (Neon)

1. Allez sur https://neon.tech, inscrivez-vous (le plus simple : "Continuer avec
   GitHub").
2. Créez un nouveau projet (nom libre, ex: `seourouapps`).
3. Une fois créé, Neon affiche une **chaîne de connexion** qui ressemble à :
   `postgresql://user:password@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. Copiez-la et gardez-la de côté — vous en aurez besoin à l'étape 3.

## Étape 2 — Pousser le code sur GitHub

Dans un terminal, à la racine du projet :

```bash
cd "C:\Users\Lancine Adama Keita\Desktop\seourou\seourouApps"
git init
git add .
git commit -m "Version web/PWA prête pour le déploiement"
```

Puis sur https://github.com/new, créez un nouveau dépôt (par exemple `seourouApps`),
**vide** (ne cochez ni README ni .gitignore — vous les avez déjà). GitHub vous
donnera ensuite des commandes du type :

```bash
git remote add origin https://github.com/<votre-compte>/seourouApps.git
git branch -M main
git push -u origin main
```

Copiez-collez exactement ce que GitHub affiche pour vous (l'URL contient votre nom
d'utilisateur).

## Étape 3 — Déployer sur Render

1. Allez sur https://render.com, inscrivez-vous avec GitHub (autorisez l'accès à vos
   dépôts, au moins celui que vous venez de créer).
2. Cliquez **New +** → **Blueprint**.
3. Choisissez le dépôt `seourouApps`. Render détecte automatiquement le fichier
   `render.yaml` à la racine et propose de créer un service nommé `seourouapps`.
4. Avant de valider, Render vous demande la valeur de `DATABASE_URL` (les autres
   variables — `JWT_SECRET`, etc. — sont déjà pré-remplies automatiquement). Collez
   la chaîne de connexion Neon récupérée à l'étape 1.
5. Cliquez **Apply** / **Create**. Le premier déploiement prend quelques minutes
   (installation des dépendances + migration de la base).

Une fois terminé, Render affiche une URL du type :
`https://seourouapps.onrender.com`

C'est votre application, accessible depuis n'importe où sur internet.

## Étape 4 — Tester depuis votre iPhone

1. Sur l'iPhone, ouvrez Safari et allez sur l'URL Render (ex:
   `https://seourouapps.onrender.com`).
2. Créez un compte, testez le chat et un appel (avec un deuxième compte ouvert sur le
   PC, par exemple).
3. Optionnel — l'installer comme une app : bouton **Partager** (le carré avec la
   flèche) → **Sur l'écran d'accueil**. Une icône seourouApps apparaît alors comme
   une vraie application.

## À savoir

- Le plan gratuit de Render met le service en veille après ~15 minutes sans trafic :
  la première requête après une pause peut prendre 30 à 60 secondes à répondre (le
  temps qu'il se "réveille"). C'est normal, pas un bug.
- Pour remettre à jour l'app plus tard : modifiez le code, puis
  `git add . && git commit -m "..." && git push` — Render redéploie automatiquement.
- Le dossier `mobile/` et `TempRN/` (l'app React Native native) ne sont pas touchés
  par ce déploiement — ils restent disponibles si vous voulez y revenir plus tard
  (avec un Mac pour iOS, ou plus d'espace disque pour l'émulateur Android).
