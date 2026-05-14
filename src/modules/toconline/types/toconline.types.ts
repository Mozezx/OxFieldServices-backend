export type ToconlineJson = Record<string, unknown>;

export type ToconlineSalesDocumentLine = {
  item_type: 'Service';
  description: string;
  quantity: number;
  unit_price: number;
  tax_code: string;
  tax_country_region?: string;
};
