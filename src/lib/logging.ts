// Deliberate allowlist: never log provider payloads, destinations, headers, or error.message.
export function log(
  event: string,
  fields: {
    requestId?: string;
    providerId?: string;
    jobId?: string;
    code?: string;
    durationMs?: number;
    resource?: string;
    count?: number;
  } = {},
) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: fields.code ? "error" : "info",
      event,
      ...fields,
    }),
  );
}
