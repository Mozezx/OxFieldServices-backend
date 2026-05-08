import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export type PhaseChecklistItem = {
  label: string;
  requiresPhoto: boolean;
  order: number;
};

@Injectable()
export class AIService {
  private readonly log = new Logger(AIService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      this.log.warn('DEEPSEEK_API_KEY não definida — chamadas de IA falharão.');
    }
    const baseURL =
      this.config.get<string>('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com';
    this.model = this.config.get<string>('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash';
    this.client = new OpenAI({
      apiKey: apiKey ?? 'missing',
      baseURL,
    });
  }

  private assertKey() {
    if (!this.config.get<string>('DEEPSEEK_API_KEY')) {
      throw new ServiceUnavailableException('Serviço de IA não configurado (DEEPSEEK_API_KEY).');
    }
  }

  /**
   * Legenda curta a partir da imagem (API DeepSeek, formato OpenAI multimodal quando suportado).
   */
  async generateEvidenceCaption(imageUrl: string, phaseContext: string): Promise<string> {
    this.assertKey();
    const system =
      'És um assistente de obra. Descreve em português, de forma objetiva, o que a foto mostra (trabalho em curso). ' +
      'Máximo 150 caracteres. Sem aspas nem markdown.';

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Contexto da fase: ${phaseContext}\nDescreve a imagem.`,
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 120,
        temperature: 0.4,
      });
      const raw = completion.choices[0]?.message?.content?.trim() ?? '';
      return this.clampCaption(raw);
    } catch (err) {
      this.log.warn(`generateEvidenceCaption falhou: ${String((err as Error).message)}`);
      throw new InternalServerErrorException('Falha ao gerar legenda com o DeepSeek.');
    }
  }

  private clampCaption(s: string): string {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t.length <= 150) return t;
    return t.slice(0, 147).trimEnd() + '...';
  }

  async generatePhaseChecklist(
    phaseName: string,
    projectType: string,
    skills: string[],
  ): Promise<PhaseChecklistItem[]> {
    this.assertKey();
    const skillsText = skills.length ? skills.join(', ') : '(não especificadas)';
    const user = `Fase: "${phaseName}"
Tipo / contexto do projeto: ${projectType}
Competências relevantes: ${skillsText}

Gera entre 5 e 15 itens de checklist de verificação em obra para esta fase.
Responde APENAS com um JSON array, sem markdown, no formato:
[{"label":"texto","requiresPhoto":true,"order":1},...]
Regras: "order" começa em 1 e é sequencial; label em português; requiresPhoto boolean.`;

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'Respondes só com JSON válido: um array de objetos {label, requiresPhoto, order}.',
          },
          { role: 'user', content: user },
        ],
        max_tokens: 2000,
        temperature: 0.35,
      });
      const raw = completion.choices[0]?.message?.content?.trim() ?? '';
      return this.parseChecklistJson(raw);
    } catch (err) {
      this.log.warn(`generatePhaseChecklist falhou: ${String((err as Error).message)}`);
      throw new InternalServerErrorException('Falha ao gerar checklist com o DeepSeek.');
    }
  }

  private parseChecklistJson(raw: string): PhaseChecklistItem[] {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      const m = stripped.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('JSON inválido');
      parsed = JSON.parse(m[0]);
    }
    if (!Array.isArray(parsed)) throw new Error('Esperado array');
    const out: PhaseChecklistItem[] = [];
    let i = 0;
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const label = typeof r.label === 'string' ? r.label.trim() : '';
      if (!label) continue;
      const requiresPhoto = Boolean(r.requiresPhoto);
      const order = typeof r.order === 'number' && r.order >= 1 ? r.order : ++i;
      out.push({ label, requiresPhoto, order });
    }
    out.sort((a, b) => a.order - b.order);
    return out;
  }

  async generateProjectSummary(projectData: Record<string, unknown>): Promise<string> {
    this.assertKey();
    const payload = JSON.stringify(projectData, null, 2);
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'Escreve um parágrafo executivo em português (4–8 frases) para relatório de obra, com base nos dados. ' +
              'Tom profissional. Não inventes factos que não estejam nos dados.',
          },
          {
            role: 'user',
            content: `Dados do projeto (JSON):\n${payload}`,
          },
        ],
        max_tokens: 800,
        temperature: 0.45,
      });
      return (completion.choices[0]?.message?.content ?? '').trim();
    } catch (err) {
      this.log.warn(`generateProjectSummary falhou: ${String((err as Error).message)}`);
      throw new InternalServerErrorException('Falha ao gerar resumo com o DeepSeek.');
    }
  }
}
