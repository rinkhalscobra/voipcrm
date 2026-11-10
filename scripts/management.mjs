export const projectRef = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid",
).hostname.split(".")[0];
export async function management(path, { method = "GET", body } = {}) {
  if (!process.env.SUPABASE_ACCESS_TOKEN)
    throw new Error("SUPABASE_ACCESS_TOKEN is required");
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // Management SQL errors contain only migration SQL identifiers; never dump requests or headers.
    const message =
      data?.message ?? data?.error ?? `Management API HTTP ${response.status}`;
    throw new Error(
      typeof message === "string"
        ? message
        : `Management API HTTP ${response.status}`,
    );
  }
  return data;
}
export const sql = (query, readOnly = false) =>
  management("/database/query", {
    method: "POST",
    body: { query, read_only: readOnly },
  });
