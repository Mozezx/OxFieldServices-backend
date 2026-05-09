/**
 * Garante organização OxFieldServices + OrganizationMember admin para um email.
 * Uso: node scripts/ensure-org-and-member.mjs <email>
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ORG_NAME = 'OxFieldServices';
const ORG_SLUG = 'oxfieldservices';

async function main() {
  const email = process.argv[2];
  if (!email?.includes('@')) {
    console.error('Uso: node scripts/ensure-org-and-member.mjs <email>');
    process.exit(1);
  }

  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: {
      name: ORG_NAME,
      slug: ORG_SLUG,
    },
    update: { name: ORG_NAME },
  });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`User não encontrado: ${email}`);

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
    create: {
      organizationId: org.id,
      userId: user.id,
      role: 'admin',
    },
    update: { role: 'admin' },
  });

  console.log(`OK: ${email} → Organization "${org.name}" (${org.slug}) como admin`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
