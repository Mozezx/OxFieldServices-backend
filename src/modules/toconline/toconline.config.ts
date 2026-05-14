import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ToconlineConfig {
  readonly apiBaseUrl: string;
  readonly atUsername: string | undefined;
  /** Palavra-passe do portal AT em Base64 (valor enviado à API TOConline). */
  readonly atPasswordBase64: string | undefined;
  readonly defaultTaxCode: string;
  readonly defaultDocumentTypeSent: string;
  readonly defaultDocumentTypePaid: string;
  readonly fiscalBucket: string;

  constructor(private readonly config: ConfigService) {
    this.apiBaseUrl = (
      this.config.get<string>('TOCONLINE_API_URL')?.trim() ??
      'https://api11.toconline.pt'
    ).replace(/\/$/, '');
    this.atUsername = this.config.get<string>('TOCONLINE_AT_USERNAME')?.trim();
    this.atPasswordBase64 = this.config
      .get<string>('TOCONLINE_AT_PASSWORD_BASE64')
      ?.trim();
    this.defaultTaxCode =
      this.config.get<string>('TOCONLINE_DEFAULT_TAX_CODE')?.trim() ?? 'NOR';
    this.defaultDocumentTypeSent =
      this.config.get<string>('TOCONLINE_DEFAULT_DOCUMENT_TYPE')?.trim() ?? 'FT';
    this.defaultDocumentTypePaid =
      this.config.get<string>('TOCONLINE_PAID_DOCUMENT_TYPE')?.trim() ?? 'FR';
    this.fiscalBucket =
      this.config.get<string>('TOCONLINE_FISCAL_STORAGE_BUCKET')?.trim() ??
      'invoices-fiscal';
  }

  hasAtCredentials(): boolean {
    return !!this.atUsername && !!this.atPasswordBase64;
  }
}
