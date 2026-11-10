import { z } from "zod";
export const numeric = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(\.\d+)?$/),
]);
export const providerId = z
  .union([z.string().min(1), z.number().int()])
  .transform(String);
export const balanceSchema = z.object({
  credit: numeric,
  credit_limit: numeric,
  balance: numeric,
});
export const userSchema = z
  .object({ id: providerId, name: z.string(), realname: z.string().nullish() })
  .passthrough();
export const deviceSchema = z
  .object({
    name: z.string(),
    user_id: providerId.nullish(),
    is_online: z.boolean().optional(),
  })
  .passthrough();
export const didSchema = z
  .object({
    id: providerId,
    did: z.string(),
    country_name: z.string().optional(),
    activated: z.number().int(),
    monthly_price: numeric.optional(),
    next_payment_date: z.string().nullish(),
  })
  .passthrough();
export const callSchema = z
  .object({
    call_id: z.string(),
    starttime: z.string(),
    stoptime: z.string().nullish(),
    direction: z.string(),
    status: z.string(),
    duration_sec: z.number().int().nonnegative().nullish(),
    handle_sec: z.number().int().nonnegative().nullish(),
    cost: numeric.nullish(),
    caller: z
      .object({
        number: z.string().nullish(),
        cid: z.string().nullish(),
        dnid: z.string().nullish(),
        user_id: providerId.nullish(),
      })
      .passthrough(),
    callee: z
      .object({ number: z.string().nullish(), user_id: providerId.nullish() })
      .passthrough(),
    audio_url: z.string().nullish(),
  })
  .passthrough();
export const statusSchema = z
  .object({
    id: providerId,
    name: z.string(),
    enabled: z.boolean(),
    is_offline: z.boolean(),
  })
  .passthrough();
export const e164 = z
  .string()
  .regex(
    /^\+[1-9]\d{6,14}$/,
    "Use an international number, for example +493012345678.",
  );
export const click2callSchema = z
  .object({
    data: z
      .object({
        caller_number: z.string().min(1),
        destination_number: e164,
        destination_displayname: e164,
      })
      .strict(),
  })
  .strict();
export interface ProviderCapabilities {
  balance: boolean;
  users: boolean;
  devices: boolean;
  dids: boolean;
  calls: boolean;
  click2call: boolean;
  webphone: boolean;
  webhooks: boolean;
  statusDefinitionsWrite: boolean;
  orderReconciliation: boolean;
}
export const capabilities: ProviderCapabilities = {
  balance: true,
  users: true,
  devices: true,
  dids: true,
  calls: true,
  click2call: true,
  webphone: false,
  webhooks: false,
  statusDefinitionsWrite: false,
  orderReconciliation: false,
};
