export interface HubspotDealDto {
  dealname: string;
  pipeline: string;
  dealstage: string;
  amount?: string;
  ox_project_id: string;
  ox_project_status: string;
  ox_invoice_stripe_link?: string;
  ox_contract_signed_at?: string;
  ox_workers_count?: number;
}
