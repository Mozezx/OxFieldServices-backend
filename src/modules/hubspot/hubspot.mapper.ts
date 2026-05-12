import { Injectable } from '@nestjs/common';
import { Organization, User, Project } from '@prisma/client';
import { HubspotCompanyDto } from './dto/company.dto';
import { HubspotContactDto } from './dto/contact.dto';
import { HubspotDealDto } from './dto/deal.dto';
import { HubspotConfig } from './hubspot.config';

@Injectable()
export class HubspotMapper {
  constructor(private readonly config: HubspotConfig) {}

  toCompany(org: Organization): HubspotCompanyDto {
    return {
      name: org.name,
      ox_organization_id: org.id,
      ox_plan: org.planTier,
    };
  }

  toContact(user: User): HubspotContactDto {
    const [firstname, ...rest] = user.name.split(' ');
    return {
      email: user.email,
      firstname,
      lastname: rest.join(' ') || undefined,
      ox_user_id: user.id,
      ox_role: user.role,
    } as any;
  }

  toDeal(project: Project): HubspotDealDto {
    return {
      dealname: project.title,
      pipeline: this.config.projectsPipelineId,
      dealstage: this.config.stageMap[project.status] ?? '',
      amount: project.budget?.toString(),
      ox_project_id: project.id,
      ox_project_status: project.status,
    };
  }
}
