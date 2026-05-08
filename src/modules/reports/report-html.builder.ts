import { ReportType } from '@prisma/client';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export type ReportPdfProjectPayload = {
  title: string;
  location: string;
  budget: string;
  organizationName: string;
  clientName: string;
  workerName: string | null;
  phases: Array<{
    name: string;
    order: number;
    status: string;
    amount: string;
    evidences: Array<{
      url: string;
      type: string;
      uploadedAt: string;
      uploaderName: string;
      aiCaption: string | null;
    }>;
  }>;
  payments: Array<{
    amount: string;
    recipientType: string;
    paidAt: string | null;
  }>;
};

function renderEvidenceTable(
  rows: ReportPdfProjectPayload['phases'][0]['evidences'],
): string {
  const body = rows
    .map(
      (e) => `
          <tr>
            <td>${escapeHtml(e.uploadedAt)}</td>
            <td>${escapeHtml(e.uploaderName)}</td>
            <td>${escapeHtml(e.type)}</td>
            <td>${escapeHtml(e.aiCaption ?? '—')}</td>
            <td>${escapeHtml(e.url)}</td>
          </tr>`,
    )
    .join('');
  return `
        <table class="ev">
          <thead><tr><th>Data</th><th>Autor</th><th>Tipo</th><th>Legenda IA</th><th>URL</th></tr></thead>
          <tbody>${body}</tbody>
        </table>`;
}

function renderPhasesBlock(
  reportType: ReportType,
  payload: ReportPdfProjectPayload,
): string {
  if (reportType === 'PAYMENT_SUMMARY') {
    return '';
  }

  if (reportType === 'PHASE_SUMMARY') {
    return payload.phases
      .map(
        (ph) => `
      <section class="phase">
        <h3>${escapeHtml(ph.name)} <span class="muted">(#${ph.order})</span></h3>
        <p><strong>Estado:</strong> ${escapeHtml(ph.status)}</p>
        <p><strong>Valor:</strong> ${escapeHtml(ph.amount)}</p>
        <p class="muted">${ph.evidences.length} evidência(s) registada(s)</p>
      </section>`,
      )
      .join('');
  }

  return payload.phases
    .map((ph) => {
      let evList = ph.evidences;
      if (reportType === 'DAILY_LOG') {
        evList = [...ph.evidences].sort(
          (a, b) =>
            new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        );
      }

      const evBlock =
        reportType === 'FULL' || reportType === 'DAILY_LOG'
          ? evList.length
            ? renderEvidenceTable(evList)
            : '<p class="muted">Sem evidências</p>'
          : '';

      const amountLine =
        reportType === 'FULL'
          ? `<p class="muted">Valor da fase: ${escapeHtml(ph.amount)}</p>`
          : '';

      return `
      <section class="phase">
        <h3>${escapeHtml(ph.name)} <span class="muted">(#${ph.order})</span> — ${escapeHtml(ph.status)}</h3>
        ${amountLine}
        ${evBlock}
      </section>`;
    })
    .join('');
}

function renderPaymentsBlock(
  reportType: ReportType,
  payload: ReportPdfProjectPayload,
): string {
  if (reportType === 'PHASE_SUMMARY') {
    return '';
  }

  const paymentsRows = payload.payments
    .map(
      (p) => `
    <tr>
      <td>${escapeHtml(p.recipientType)}</td>
      <td>${escapeHtml(p.amount)}</td>
      <td>${escapeHtml(p.paidAt ?? '—')}</td>
    </tr>`,
    )
    .join('');

  return `
    <h2>Pagamentos</h2>
    <table>
      <thead><tr><th>Destinatário</th><th>Valor</th><th>Data</th></tr></thead>
      <tbody>${paymentsRows || '<tr><td colspan="3">Sem pagamentos registados</td></tr>'}</tbody>
    </table>`;
}

export function buildReportHtml(
  reportType: ReportType,
  payload: ReportPdfProjectPayload,
): string {
  const titleSuffix =
    reportType === 'FULL'
      ? 'Relatório completo'
      : reportType === 'DAILY_LOG'
        ? 'Registo diário (evidências)'
        : reportType === 'PHASE_SUMMARY'
          ? 'Resumo por fases'
          : 'Resumo financeiro';

  const phasesBlock = renderPhasesBlock(reportType, payload);
  const paymentsBlock = renderPaymentsBlock(reportType, payload);

  const budgetLine =
    reportType !== 'PAYMENT_SUMMARY'
      ? `<div><strong>Orçamento:</strong> ${escapeHtml(payload.budget)}</div>`
      : '';

  const phasesHeading =
    reportType !== 'PAYMENT_SUMMARY' ? `<h2>Fases</h2>${phasesBlock}` : '';

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: DejaVu Sans, Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    h2 { font-size: 15px; margin-top: 20px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    h3 { font-size: 13px; margin-top: 12px; }
    .meta { margin-bottom: 16px; }
    .muted { color: #555; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
    .phase { page-break-inside: avoid; margin-bottom: 16px; }
    table.ev td:nth-child(5) { word-break: break-all; font-size: 10px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(payload.title)}</h1>
  <p class="meta"><strong>${escapeHtml(titleSuffix)}</strong></p>
  <div class="meta">
    <div><strong>Organização:</strong> ${escapeHtml(payload.organizationName)}</div>
    <div><strong>Cliente:</strong> ${escapeHtml(payload.clientName)}</div>
    <div><strong>Worker:</strong> ${escapeHtml(payload.workerName ?? '—')}</div>
    <div><strong>Local:</strong> ${escapeHtml(payload.location)}</div>
    ${budgetLine}
  </div>
  ${phasesHeading}
  ${paymentsBlock}
</body>
</html>`;
}
