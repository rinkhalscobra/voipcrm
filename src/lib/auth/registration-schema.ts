import { z } from "zod";
export const registrationSchema = z
  .object({
    full_name: z.string().trim().min(2).max(100),
    company_name: z.string().trim().min(2).max(160),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8).max(128),
    country: z.string().trim().min(2).max(80),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
