/**
 * AuditExportService (C15) — gera o PDF de auditoria de uma clínica num período,
 * com hash SHA256 verificável, e devolve uma signed URL (7 dias).
 *
 * Orquestra (review #7): query (AuditRepository) → render PDF (@react-pdf,
 * reusa Footer/styles de src/lib/pdf) → SHA256 (sobre o JSON canônico das
 * linhas — carimbado no PDF + retornado, sem auto-referência) → upload
 * (admin-exports) → signed URL.
 *
 * Server-only.
 */
import 'server-only';

import { createHash } from 'node:crypto';

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import stringify from 'safe-stable-stringify';

import { clinics } from '@/contexts/tenancy/schema';
import { dbAdmin } from '@/lib/db';
import { Footer, formatDate, styles as baseStyles } from '@/lib/pdf/components';
import {
  ADMIN_EXPORT_TTL_SECONDS,
  createSignedAdminExportUrl,
  uploadAdminExport,
} from '@/lib/storage/admin-exports';

import type { AuditEntryDTO, AuditExportResultDTO } from '../dto';
import { AUDIT_EXPORT_MAX_ROWS, auditRepository } from '../repositories/audit.repo';

/**
 * B6 — o período rende mais eventos do que o export consegue atestar.
 *
 * O repositório corta em `AUDIT_EXPORT_MAX_ROWS`. Antes, o corte era SILENCIOSO: o
 * PDF saía com as primeiras N linhas e o `sha256` — que existe para ser prova — ia
 * para `super_admin_actions` como se atestasse o período inteiro. Um artefato de
 * auditoria incompleto que se apresenta como completo é pior que a ausência dele.
 *
 * `code` + `httpStatus` seguem o padrão de domain error do repo, então
 * `toErrorResponse` mapeia 1:1 (envelope + 422) sem o caller precisar saber.
 */
export class AuditExportTooLargeError extends Error {
  readonly code = 'audit_export_too_large';
  readonly httpStatus = 422;
  constructor(readonly rowCount: number) {
    super(
      `Período gera ${rowCount}+ eventos e o export sairia incompleto ` +
        `(teto de ${AUDIT_EXPORT_MAX_ROWS}). Reduza o intervalo e exporte em partes.`,
    );
    this.name = 'AuditExportTooLargeError';
  }
}

const t = StyleSheet.create({
  meta: { fontSize: 9, color: '#4b5563', marginBottom: 2 },
  hash: { fontSize: 8, color: '#6b7280', fontFamily: 'Courier', marginTop: 4, marginBottom: 10 },
  th: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1f2937', paddingBottom: 3, marginBottom: 3 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 2 },
  cTime: { width: '24%', fontSize: 8 },
  cAction: { width: '26%', fontSize: 8 },
  cEntity: { width: '24%', fontSize: 8 },
  cUser: { width: '16%', fontSize: 8 },
  cIp: { width: '10%', fontSize: 8 },
  thText: { fontFamily: 'Helvetica-Bold', fontSize: 8 },
});

function AuditExportDoc(props: {
  clinicNome: string;
  from: string;
  to: string;
  sha256: string;
  rows: AuditEntryDTO[];
  generatedAt: string;
}) {
  return (
    <Document>
      <Page size="A4" style={baseStyles.page}>
        <Text style={baseStyles.docTitle}>Exportação de Auditoria</Text>
        <Text style={t.meta}>Clínica: {props.clinicNome}</Text>
        <Text style={t.meta}>
          Período: {formatDate(props.from)} — {formatDate(props.to)}
        </Text>
        <Text style={t.meta}>
          Gerado em: {props.generatedAt} · {props.rows.length} evento(s)
        </Text>
        <Text style={t.hash}>SHA256: {props.sha256}</Text>

        <View style={t.th}>
          <Text style={[t.cTime, t.thText]}>Data/Hora (UTC)</Text>
          <Text style={[t.cAction, t.thText]}>Ação</Text>
          <Text style={[t.cEntity, t.thText]}>Entidade</Text>
          <Text style={[t.cUser, t.thText]}>Usuário</Text>
          <Text style={[t.cIp, t.thText]}>IP</Text>
        </View>

        {props.rows.map((r) => (
          <View key={r.id} style={t.tr} wrap={false}>
            <Text style={t.cTime}>{r.timestamp}</Text>
            <Text style={t.cAction}>{r.action}</Text>
            <Text style={t.cEntity}>
              {r.resourceType}
              {r.resourceId ? `:${r.resourceId.slice(0, 8)}` : ''}
            </Text>
            <Text style={t.cUser}>{r.userId ? r.userId.slice(0, 8) : '—'}</Text>
            <Text style={t.cIp}>{r.ip ?? '—'}</Text>
          </View>
        ))}

        <Footer />
      </Page>
    </Document>
  );
}

export class AuditExportService {
  async run(input: {
    clinicId: string;
    from: string; // ISO
    to: string; // ISO
  }): Promise<AuditExportResultDTO> {
    const { clinicId, from, to } = input;

    const [clinic] = await dbAdmin
      .select({ nome: clinics.nome })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
    const clinicNome = clinic?.nome ?? clinicId;

    const rows = await auditRepository.findByClinicRange(clinicId, from, to);

    // B6: falha ANTES do render/upload — barrar depois deixaria um PDF órfão no
    // storage a cada tentativa (o artefato é gerado antes de qualquer validação).
    if (rows.length >= AUDIT_EXPORT_MAX_ROWS) throw new AuditExportTooLargeError(rows.length);

    // SHA256 sobre o conteúdo canônico (não sobre o arquivo) — evita auto-ref.
    const canonical = stringify({ clinicId, from, to, rows }) ?? '';
    const sha256 = createHash('sha256').update(canonical).digest('hex');

    const buffer = await renderToBuffer(
      <AuditExportDoc
        clinicNome={clinicNome}
        from={from}
        to={to}
        sha256={sha256}
        rows={rows}
        generatedAt={new Date().toISOString()}
      />,
    );

    const path = `${clinicId}/${Date.now()}_${sha256.slice(0, 12)}.pdf`;
    await uploadAdminExport(path, buffer);
    const signedUrl = await createSignedAdminExportUrl(path, ADMIN_EXPORT_TTL_SECONDS);

    return { signedUrl, sha256, expiresInDays: 7, rowCount: rows.length };
  }
}

export const auditExportService = new AuditExportService();
