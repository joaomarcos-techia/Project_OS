/**
 * Limites compartilhados pelo cliente, pela Server Action e pelo bucket.
 *
 * A Vercel limita o corpo de uma Function a 4,5 MB. Reservamos 256 KB para o
 * envelope multipart da Server Action e mantemos o arquivo em no máximo 4 MB.
 */
export const CLINIC_LOGO_MAX_BYTES = 4 * 1024 * 1024;
export const CLINIC_LOGO_MAX_LABEL = '4 MB';
export const CLINIC_LOGO_ACTION_BODY_SIZE_LIMIT = '4.25mb';
