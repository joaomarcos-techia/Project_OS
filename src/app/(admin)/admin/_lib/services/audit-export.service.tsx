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
import { Footer, styles as baseStyles } from '@/lib/pdf/components';
import {
  ADMIN_EXPORT_TTL_SECONDS,
  createSignedAdminExportUrl,
  uploadAdminExport,
} from '@/lib/storage/admin-exports';

import type { AuditEntryDTO, AuditExportResultDTO } from '../dto';
import { auditRepository } from '../repositories/audit.repo';

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
          Período: {props.from} — {props.to}
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
