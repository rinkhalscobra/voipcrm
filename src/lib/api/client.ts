"use client";
export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  options?: { method?: string; data?: unknown },
): Promise<{
  data: T;
  meta?: { total: number; page: number; pageSize: number };
}> {
  const response = await fetch(`/api/${path}`, {
    method: options?.method ?? "GET",
    headers: options?.data ? { "Content-Type": "application/json" } : undefined,
    body: options?.data ? JSON.stringify(options.data) : undefined,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok)
    throw new ClientError(
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? "The request could not be completed.",
      payload.error?.requestId,
    );
  return payload;
}
