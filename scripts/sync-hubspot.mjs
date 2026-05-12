/**
 * Sync manual para o HubSpot.
 * Uso:
 *   node scripts/sync-hubspot.mjs org                  — sincroniza a primeira org
 *   node scripts/sync-hubspot.mjs org <orgId>           — sincroniza org específica
 *   node scripts/sync-hubspot.mjs user <email>          — sincroniza user por email
 *   node scripts/sync-hubspot.mjs project <projectId>  — sincroniza projeto como Deal
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config(); // fallback para .env
import { PrismaClient } from '@prisma/client';
import { Client } from '@hubspot/api-client';

const prisma = new PrismaClient();
const hs = new Client({ accessToken: process.env.HUBSPOT_PRIVATE_APP_TOKEN });

async function upsertCompany(org) {
  const props = {
    name: org.name,
    ox_organization_id: org.id,
    ox_plan: org.planTier ?? 'free',
  };

  let hubspotId = org.hubspotCompanyId;
  if (hubspotId) {
    await hs.crm.companies.basicApi.update(hubspotId, { properties: props });
    console.log(`✔ Company atualizada  id=${hubspotId}`);
  } else {
    const res = await hs.crm.companies.basicApi.create({ properties: props });
    hubspotId = res.id;
    await prisma.organization.update({
      where: { id: org.id },
      data: { hubspotCompanyId: hubspotId },
    });
    console.log(`✔ Company criada  id=${hubspotId}`);
  }
  return hubspotId;
}

async function upsertContact(user, hubspotCompanyId) {
  const [firstname, ...rest] = user.name.split(' ');
  const props = {
    email: user.email,
    firstname,
    lastname: rest.join(' ') || '',
    ox_user_id: user.id,
    ox_role: user.role,
  };

  let hubspotId = user.hubspotContactId;
  if (hubspotId) {
    await hs.crm.contacts.basicApi.update(hubspotId, { properties: props });
    console.log(`✔ Contact atualizado  id=${hubspotId}`);
  } else {
    const res = await hs.crm.contacts.basicApi.create({ properties: props });
    hubspotId = res.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { hubspotContactId: hubspotId },
    });
    console.log(`✔ Contact criado  id=${hubspotId}`);

    if (hubspotCompanyId) {
      await hs.crm.associations.v4.basicApi.create(
        'contacts', hubspotId,
        'companies', hubspotCompanyId,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }],
      );
      console.log(`✔ Associado à company ${hubspotCompanyId}`);
    }
  }
}

async function upsertDeal(project, pipelineId) {
  const stageMap = {
    draft:            'appointmentscheduled',
    matched:          'qualifiedtobuy',
    contract_signed:  'presentationscheduled',
    active_escrow:    'decisionmakerboughtin',
    in_execution:     'contractsent',
    closing:          'contractsent',
    closed:           'closedwon',
    rejected:         'closedlost',
  };

  const props = {
    dealname: project.title,
    pipeline: pipelineId || 'default',
    dealstage: stageMap[project.status] ?? 'appointmentscheduled',
    ...(project.budget != null ? { amount: String(project.budget) } : {}),
    ox_project_id: project.id,
    ox_project_status: project.status,
  };

  let hubspotId = project.hubspotDealId;
  if (hubspotId) {
    await hs.crm.deals.basicApi.update(hubspotId, { properties: props });
    console.log(`✔ Deal atualizado  id=${hubspotId}`);
  } else {
    const res = await hs.crm.deals.basicApi.create({ properties: props });
    hubspotId = res.id;
    await prisma.project.update({
      where: { id: project.id },
      data: { hubspotDealId: hubspotId },
    });
    console.log(`✔ Deal criado  id=${hubspotId}`);

    // Associar ao Company da org (se disponível)
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { hubspotCompanyId: true } });
    if (org?.hubspotCompanyId) {
      await hs.crm.associations.v4.basicApi.create(
        'deals', hubspotId,
        'companies', org.hubspotCompanyId,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }],
      );
      console.log(`✔ Deal associado à company ${org.hubspotCompanyId}`);
    }
  }
}

async function main() {
  const [target, arg] = process.argv.slice(2);

  if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
    console.error('❌  HUBSPOT_PRIVATE_APP_TOKEN não definido no .env');
    process.exit(1);
  }

  if (target === 'org') {
    const org = arg
      ? await prisma.organization.findUnique({ where: { id: arg } })
      : await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });

    if (!org) { console.error('Org não encontrada'); process.exit(1); }
    console.log(`Org: ${org.name}  (${org.id})`);
    await upsertCompany(org);

  } else if (target === 'user') {
    if (!arg) { console.error('Informe o email: node sync-hubspot.mjs user <email>'); process.exit(1); }
    const user = await prisma.user.findUnique({ where: { email: arg.toLowerCase() } });
    if (!user) { console.error('User não encontrado'); process.exit(1); }

    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user.id },
      select: { organization: { select: { hubspotCompanyId: true } } },
    });
    const hubspotCompanyId = membership?.organization?.hubspotCompanyId ?? undefined;
    console.log(`User: ${user.name} <${user.email}>  (${user.id})`);
    await upsertContact(user, hubspotCompanyId);

  } else if (target === 'project') {
    if (!arg) { console.error('Informe o projectId: node sync-hubspot.mjs project <id>'); process.exit(1); }
    const project = await prisma.project.findUnique({ where: { id: arg } });
    if (!project) { console.error('Project não encontrado'); process.exit(1); }
    console.log(`Project: ${project.title}  status=${project.status}  (${project.id})`);
    await upsertDeal(project, process.env.HUBSPOT_PROJECTS_PIPELINE_ID);

  } else {
    console.log('Uso:');
    console.log('  node scripts/sync-hubspot.mjs org');
    console.log('  node scripts/sync-hubspot.mjs org <orgId>');
    console.log('  node scripts/sync-hubspot.mjs user <email>');
    console.log('  node scripts/sync-hubspot.mjs project <projectId>');
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
