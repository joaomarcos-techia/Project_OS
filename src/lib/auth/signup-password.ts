import { z } from 'zod';

/** Contrato local alinhado à política do produto e ao limite do Supabase Auth. */
export const SIGNUP_PASSWORD_MIN_CHARACTERS = 8;
export const SIGNUP_PASSWORD_MAX_BYTES = 72;

/** Puro e compartilhável com a UI; senha nunca é normalizada ou persistida. */
export const signupPasswordSchema = z.string().refine((password) => {
  const characters = Array.from(password).length;
  const bytes = new TextEncoder().encode(password).length;
  return (
    characters >= SIGNUP_PASSWORD_MIN_CHARACTERS &&
    bytes <= SIGNUP_PASSWORD_MAX_BYTES &&
    /[A-Z]/u.test(password) &&
    /[a-z]/u.test(password) &&
    /[0-9]/u.test(password) &&
    !/\p{White_Space}/u.test(password) &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(password)
  );
});
