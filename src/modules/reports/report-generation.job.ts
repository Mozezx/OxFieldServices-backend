import { ReportType } from '@prisma/client';

export type ReportGenerationJobData = {
  reportId: string;
  projectId: string;
  organizationId: string;
  type: ReportType;
};
