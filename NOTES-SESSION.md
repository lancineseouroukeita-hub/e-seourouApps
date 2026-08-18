# Où on s'est arrêté — seourouApps

## Ce qui a été fait
- Le projet **seourouApps** (chat + appels vidéo/audio, dossier `backend/` + `mobile/` + `TempRN`) a été retrouvé dans `Desktop\seourou\seourouApps`.
- Tentative de faire tourner l'app sur émulateur Android : bloquée par un manque d'espace disque sur C: (quasiment plein). Non résolue, mise de côté.
- Solution retenue à la place : un **testeur web** (`testeurSeourouApps.html`, dans le dossier `seourouApps`) qui tourne dans un navigateur (PC, Android, iPhone) sans Android Studio ni émulateur. Il se connecte au backend existant (chat + appels WebRTC en mesh).
- Le backend (`backend/`, PostgreSQL déjà migré) fonctionne : `npm run dev` répond `{"status":"ok"}` sur `http://localhost:4000/health`.
- Le testeur fonctionne en local sur le PC (deux onglets Chrome = deux comptes).

## Ce qui bloque pour tester avec quelqu'un d'autre (par ex. sur téléphone)
- Le PC a un **VPN** ("ProTUN"/VPNMaster) qui bloquait les connexions réseau locales — **désactivé**, ça a débloqué l'accès depuis le PC lui-même via l'IP Wi-Fi (`11.5.5.105`).
- Le **pare-feu Windows** a été réglé pour autoriser Node.js (Privé + Public).
- **Problème restant** : le téléphone ne peut toujours pas se connecter, alors que le PC le peut. Cause probable : **isolation entre appareils (AP isolation)** sur le Wi-Fi — confirmé que c'est un réseau **partagé/public** (pas le routeur personnel de l'utilisateur), donc impossible de désactiver cette isolation dans les paramètres du routeur.

## Prochaine étape (à faire demain)
Utiliser le **point d'accès mobile de Windows** pour contourner l'isolation :
1. PC : Paramètres → "Point d'accès mobile" → Activer, noter nom réseau + mot de passe
2. Téléphone : se déconnecter du Wi-Fi partagé, se connecter à ce nouveau point d'accès créé par le PC
3. PC : refaire `ipconfig`, chercher la nouvelle carte (souvent IP `192.168.137.1`)
4. Téléphone : ouvrir `http://<cette-IP>:5500/testeurSeourouApps.html`
5. Vérifier que les deux terminaux sont actifs : `serve -l 5500` (dans `seourouApps/`) et `npm run dev` (dans `backend/`)

## Rappel des commandes utiles
```
# Terminal 1 - backend
cd "C:\Users\Lancine Adama Keita\Desktop\seourou\seourouApps\backend"
npm run dev

# Terminal 2 - servir le testeur web sur le réseau
cd "C:\Users\Lancine Adama Keita\Desktop\seourou\seourouApps"
npx serve -l 5500
```
