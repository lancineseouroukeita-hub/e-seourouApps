const { PrismaClient } = require('@prisma/client');

// Instance unique du client Prisma partagée dans toute l'application
const prisma = new PrismaClient();

module.exports = prisma;
