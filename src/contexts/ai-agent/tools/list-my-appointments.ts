import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API pública entre contextos. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { registerTool } from './registry';

const InputSchema = z.object({});
const AppointmentSchema = z.object({
  appointment_id: z.string().uuid(),
  scheduled_at: z.string(),
  status: z.string(),
  doctor_name: z.string(),
  procedure_name: z.string(),
});
const OutputSchema = z.object({ appointments: z.array(AppointmentSchema) });

registerTool({
  name: 'list_my_appointments',
  description:
    'Lista as consultas futuras do paciente identificado. Use antes de confirmar quando não houver uma consulta inequívoca no contexto.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (_input, ctx) => {
    if (!ctx.patientId || ctx.identityAmbiguous) {
      throw new Error('paciente não identificado de forma inequívoca');
    }
    const appointments = await schedulingApiV1.listPatientAppointments(
      ctx.clinicId,
      ctx.patientId,
      10,
    );
    return {
      appointments: appointments.map((appointment) => ({
        appointment_id: appointment.id,
        scheduled_at: appointment.scheduledAt,
        status: appointment.status,
        doctor_name: appointment.snapshotDoctorNome,
        procedure_name: appointment.snapshotProcedureName,
      })),
    };
  },
});
