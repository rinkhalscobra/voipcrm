import { z } from "zod";

export const clientAccountSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    password: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(8).max(128).optional(),
    ),
    active: z.boolean(),
  })
  .strict();

export type ClientAccountInput = z.infer<typeof clientAccountSchema>;
