import { z } from "zod";
import settings from "./email-verification-settings.json";

export const verificationEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email());

export const verifyEmailSchema = z
  .object({
    email: verificationEmail,
    code: z.string().regex(new RegExp(`^[0-9]{${settings.codeLength}}$`)),
  })
  .strict();

export const resendVerificationSchema = z
  .object({ email: verificationEmail })
  .strict();
