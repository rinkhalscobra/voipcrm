import { z } from "zod";
import { AppError } from "../errors";
import {
  balanceSchema,
  callSchema,
  click2callSchema,
  deviceSchema,
  didSchema,
  statusSchema,
  userSchema,
} from "./contracts";
export class TelTelClient {
  private readonly key: string;
  constructor(
    credentials: { apiKey: string; accountId: string },
    private readonly transport: typeof fetch = fetch,
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.key = credentials.apiKey;
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<unknown> {
    const read = method === "GET";
    for (let attempt = 0; attempt < (read ? 3 : 1); attempt++) {
      let response: Response;
      try {
        response = await this.transport(`https://api.teltel.io/v2${path}`, {
          method,
          headers: {
            "X-API-KEY": this.key,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15000),
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        if (!read) throw new AppError("PROVIDER_OUTCOME_UNKNOWN", 502);
        if (attempt < 2) {
          await this.pause(400 * 2 ** attempt);
          continue;
        }
        throw new AppError("PROVIDER_TIMEOUT", 504);
      }
      if ([401, 403].includes(response.status))
        throw new AppError("PROVIDER_AUTH", 502);
      if (
        read &&
        (response.status === 429 || response.status >= 500) &&
        attempt < 2
      ) {
        const seconds = Number(response.headers.get("retry-after"));
        await this.pause(
          Math.min(
            10000,
            Math.max(
              400 * 2 ** attempt,
              Number.isFinite(seconds) ? seconds * 1000 : 0,
            ),
          ),
        );
        continue;
      }
      if (!response.ok)
        throw new AppError(
          !read && response.status >= 500
            ? "PROVIDER_OUTCOME_UNKNOWN"
            : response.status >= 500 || response.status === 429
              ? "PROVIDER_UNAVAILABLE"
              : "PROVIDER_REJECTED",
          502,
        );
      try {
        return await response.json();
      } catch {
        throw new AppError(
          read ? "PROVIDER_SCHEMA" : "PROVIDER_OUTCOME_UNKNOWN",
          502,
        );
      }
    }
    throw new AppError("PROVIDER_UNAVAILABLE", 502);
  }
  private parse<T>(schema: z.ZodType<T>, payload: unknown): T {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new AppError("PROVIDER_SCHEMA", 502);
    return parsed.data;
  }
  async balance() {
    const data = this.parse(
      z.object({
        data: z.union([balanceSchema, z.array(balanceSchema).length(1)]),
      }),
      await this.request("/account/balance"),
    );
    return Array.isArray(data.data) ? data.data[0] : data.data;
  }
  private async list<T>(path: string, schema: z.ZodType<T>) {
    return this.parse(
      z.object({ data: z.array(schema) }),
      await this.request(path),
    ).data;
  }
  users() {
    return this.list("/users", userSchema);
  }
  devices() {
    return this.list("/devices", deviceSchema);
  }
  statuses() {
    return this.list("/user-statuses", statusSchema);
  }
  async dids() {
    const rows: z.infer<typeof didSchema>[] = [];
    for (let offset = 0; offset <= 500; offset += 500) {
      const page = await this.list(
        `/dids/my-numbers?limit=500&offset=${offset}`,
        didSchema,
      );
      rows.push(...page);
      if (page.length < 500) return rows;
    }
    throw new AppError("PAGINATION_LIMIT", 502);
  }
  async calls(since: string, until: string) {
    const rows: z.infer<typeof callSchema>[] = [];
    for (let offset = 0; offset <= 200000; offset += 1000) {
      const query = new URLSearchParams({
        limit: "1000",
        offset: String(offset),
        timezone: "UTC",
        sort: "starttime",
        filter: `starttime>${since},starttime<${until}`,
      });
      const page = await this.list(`/calls?${query}`, callSchema);
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
    throw new AppError("PAGINATION_LIMIT", 502);
  }
  async click2call(body: z.infer<typeof click2callSchema>) {
    const result = await this.request(
      "/calls",
      "POST",
      click2callSchema.parse(body),
    );
    const data = this.parse(
      z.object({ data: z.object({ status: z.number(), message: z.string() }) }),
      result,
    );
    if (data.data.status !== 200) throw new AppError("PROVIDER_REJECTED", 502);
    return { submitted: true as const };
  }
  callerIdGroups(userId: string) {
    return this.request(`/users/${encodeURIComponent(userId)}/cidgroups`);
  }
  setUserStatus(userId: string, statusId: string) {
    return this.request(
      `/users/${encodeURIComponent(userId)}/status`,
      "PATCH",
      { data: { status_id: statusId } },
    );
  }
  availableCountries() {
    return this.request("/dids/new-numbers/countries");
  }
  priceGroups(countryId: number) {
    return this.request(
      `/dids/new-numbers/countries/${countryId}/price-groups`,
    );
  }
  lookup(numbers: string[]) {
    return this.request(
      `/numbers/lookup/${numbers.map(encodeURIComponent).join(",")}`,
    );
  }
}
