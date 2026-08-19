-- Passage de l'email au numéro de téléphone comme identifiant de compte.
--
-- Choix assumé (décidé avec l'utilisateur) : comme il n'y a que quelques
-- comptes de test/famille en ligne, on repart propre plutôt que de tenter une
-- migration de données compliquée. Tout le monde recréera son compte avec un
-- numéro de téléphone au prochain lancement de l'app.
--
-- Supprimer les conversations en cascade retire aussi tous les messages, les
-- participations et les appels qui leur sont liés (ON DELETE CASCADE définis
-- dans la migration initiale). Il ne reste plus qu'à vider ensuite la table
-- "User" elle-même.
DELETE FROM "Conversation";
DELETE FROM "User";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "email";
ALTER TABLE "User" ADD COLUMN "phone" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
