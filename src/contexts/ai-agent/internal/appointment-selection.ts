export interface ConfirmableAppointment {
  id: string;
  scheduledAt: string;
}

export function selectAppointmentForConfirmation<T extends ConfirmableAppointment>(
  appointments: T[],
  selector: { appointmentId?: string; scheduledAt?: string },
): T | null {
  if (selector.appointmentId) {
    return appointments.find((appointment) => appointment.id === selector.appointmentId) ?? null;
  }
  if (selector.scheduledAt) {
    const target = new Date(selector.scheduledAt).getTime();
    if (Number.isNaN(target)) return null;
    return (
      appointments.find(
        (appointment) => new Date(appointment.scheduledAt).getTime() === target,
      ) ?? null
    );
  }
  return appointments.length === 1 ? appointments[0]! : null;
}
