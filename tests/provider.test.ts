import { describe, it, expect, vi } from "vitest";
import { TelTelClient } from "../src/lib/providers/teltel-client";
import { utcProviderTime } from "../src/lib/providers/sync";
import spec from "../docs/provider/teltel.resolved.json";
import { callSchema } from "../src/lib/providers/contracts";
const noWait = async () => {};
describe("TelTel confirmed OpenAPI contracts", () => {
  it("retains the original inbound DID separately from the shared SIP destination", () => {
    const call = callSchema.parse({
      call_id: "inbound",
      starttime: "2026-11-09 09:00:00",
      direction: "inbound",
      status: "answer",
      caller: { dnid: "493000000000" },
      callee: { number: "93534179", user_id: "company-user" },
    });
    expect(call.caller.dnid).toBe("493000000000");
    expect(call.callee.number).toBe("93534179");
  });
  it("uses a header credential and the documented balance envelope", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ credit: 20, credit_limit: 5, balance: 25 }] }),
    );
    const client = new TelTelClient(
      { accountId: "one", apiKey: "fixture-only" },
      fetcher,
      noWait,
    );
    expect(await client.balance()).toEqual({
      credit: 20,
      credit_limit: 5,
      balance: 25,
    });
    const call = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(call[0][0]).not.toContain("fixture-only");
    expect(call[0][1].headers).toHaveProperty("X-API-KEY", "fixture-only");
    expect(
      spec.paths["/account/balance"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data.type,
    ).toBe("array");
  });
  it("accepts the balance object envelope returned by the live provider", async () => {
    const client = new TelTelClient(
      { accountId: "one", apiKey: "fixture-only" },
      async () =>
        Response.json({ data: { credit: 20, credit_limit: 5, balance: 25 } }),
      noWait,
    );
    await expect(client.balance()).resolves.toEqual({
      credit: 20,
      credit_limit: 5,
      balance: 25,
    });
  });
  it("keeps provider account credentials independent", async () => {
    const keys: string[] = [];
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        keys.push((init?.headers as Record<string, string>)["X-API-KEY"]);
        return Response.json({
          data: [{ credit: 0, credit_limit: 0, balance: 0 }],
        });
      },
    );
    await Promise.all([
      new TelTelClient(
        { accountId: "a", apiKey: "fixture-a" },
        fetcher,
        noWait,
      ).balance(),
      new TelTelClient(
        { accountId: "b", apiKey: "fixture-b" },
        fetcher,
        noWait,
      ).balance(),
    ]);
    expect(keys).toEqual(["fixture-a", "fixture-b"]);
  });
  it("rejects authentication without retries and without exposing provider errors", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { errors: [{ detail: "api-key=fixture-private" }] },
        { status: 401 },
      ),
    );
    await expect(
      new TelTelClient(
        { accountId: "a", apiKey: "fixture" },
        fetcher,
        noWait,
      ).balance(),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries safe reads on throttling", async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () =>
      ++attempt < 3
        ? new Response(null, { status: 429 })
        : Response.json({ data: [] }),
    );
    await expect(
      new TelTelClient(
        { accountId: "a", apiKey: "fixture" },
        fetcher,
        noWait,
      ).users(),
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not retry call creation after a network failure", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("socket closed");
    });
    await expect(
      new TelTelClient(
        { accountId: "a", apiKey: "fixture" },
        fetcher,
        noWait,
      ).click2call({
        data: {
          caller_number: "fixture-device",
          destination_number: "+493012345678",
          destination_displayname: "+493012345678",
        },
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_OUTCOME_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("submits exact required Click2Call fields without arbitrary caller ID", async () => {
    let payload: unknown;
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        payload = JSON.parse(String(init?.body));
        return Response.json({
          data: { status: 200, message: "Callback created." },
        });
      },
    );
    await new TelTelClient(
      { accountId: "a", apiKey: "fixture" },
      fetcher,
      noWait,
    ).click2call({
      data: {
        caller_number: "fixture-device",
        destination_number: "+493012345678",
        destination_displayname: "+493012345678",
      },
    });
    expect(payload).toEqual({
      data: {
        caller_number: "fixture-device",
        destination_number: "+493012345678",
        destination_displayname: "+493012345678",
      },
    });
  });
  it("fails closed on undocumented response shapes", async () => {
    const fetcher = vi.fn(async () => Response.json({ balance: 100 }));
    await expect(
      new TelTelClient(
        { accountId: "a", apiKey: "fixture" },
        fetcher,
        noWait,
      ).balance(),
    ).rejects.toMatchObject({ code: "PROVIDER_SCHEMA" });
  });
  it("interprets timezone-less call timestamps only after requesting UTC", () =>
    expect(utcProviderTime("2026-11-09 13:45:00")).toBe(
      "2026-11-09T13:45:00.000Z",
    ));
});
