// Script à lancer UNE FOIS après le déploiement du correctif de
// normalisation des numéros de téléphone (voir utils/phone.js et
// contact.controller.js) : corrige rétroactivement les contacts déjà
// importés AVANT le correctif, qui ont été enregistrés sans indicatif
// international (ex: "622227616" au lieu de "+224622227616") et ne
// correspondaient donc jamais à un compte existant.
//
// Sans indicatif dans le numéro, on utilise l'indicatif du PROPRIÉTAIRE du
// contact (même heuristique que normalizePhone(raw, defaultDial) côté
// import) : on suppose qu'un numéro noté sans indicatif dans le répertoire
// de quelqu'un est un numéro de son propre pays.
//
// Usage :
//   cd backend
//   node scripts/backfill-contact-phones.js
//   node scripts/backfill-contact-phones.js --dry-run   (aperçu sans écrire)
//
// Sans danger à relancer plusieurs fois : les contacts déjà au format
// "+..." sont ignorés.
const prisma = require('../src/config/prisma');
const { normalizePhone, extractDialCode, PHONE_REGEX } = require('../src/utils/phone');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const contacts = await prisma.contact.findMany({
    where: { phone: { not: { startsWith: '+' } } },
    include: { owner: { select: { phone: true } } },
  });

  console.log(`${contacts.length} contact(s) sans indicatif trouvé(s).`);
  if (!contacts.length) return;

  let fixed = 0;
  let skipped = 0;
  let merged = 0;

  for (const c of contacts) {
    const myDial = extractDialCode(c.owner.phone);
    if (!myDial) {
      skipped++;
      continue; // ne devrait pas arriver : le numéro du propriétaire est toujours complet
    }
    const newPhone = normalizePhone(c.phone, myDial);
    if (!PHONE_REGEX.test(newPhone) || newPhone === c.phone) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] ${c.phone} -> ${newPhone} (contact ${c.id}, owner ${c.ownerId})`);
      fixed++;
      continue;
    }

    // Le propriétaire peut déjà avoir une entrée avec le numéro complet
    // (ex: ajoutée manuellement) : dans ce cas on fusionne au lieu de créer
    // un doublon qui violerait la contrainte unique (ownerId, phone).
    const existing = await prisma.contact.findUnique({
      where: { ownerId_phone: { ownerId: c.ownerId, phone: newPhone } },
    });
    if (existing) {
      await prisma.contact.delete({ where: { id: c.id } });
      merged++;
    } else {
      await prisma.contact.update({ where: { id: c.id }, data: { phone: newPhone } });
      fixed++;
    }
  }

  console.log(`${fixed} corrigé(s), ${merged} fusionné(s) (doublon supprimé), ${skipped} ignoré(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
