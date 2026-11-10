import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, administrator } from "@/lib/auth/server";
import { hasPermission } from "@/lib/auth/permissions";
import {
  serviceDatabase,
  isConfigured,
  serverDatabase,
} from "@/lib/supabase/server";
import { AppError, databaseError } from "@/lib/errors";
import {
  body,
  currency,
  failure,
  guardOrigin,
  money,
  ok,
  uuid,
} from "@/lib/api/http";
import { queryRows, safeCallColumns } from "@/lib/api/queries";
import { dashboard } from "@/lib/api/dashboard";
import { encryptCredential } from "@/lib/security/crypto";
import { providerClient } from "@/lib/providers/service";
import { e164 } from "@/lib/providers/contracts";
import { createHash } from "node:crypto";
import { isDemoData } from "@/lib/data-mode";
import { registerWorkspace } from "@/lib/auth/registration";
import {
  verifySignupEmail,
  resendSignupEmail,
} from "@/lib/auth/email-verification";
import { clientAccountSchema } from "@/lib/auth/client-account-schema";
import { updateClientAccount } from "@/lib/auth/client-account";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
type RouteParams = { params: Promise<{ path: string[] }> };

async function handler(request: Request, route: RouteParams) {
  try {
    guardOrigin(request);
    const { path: parts } = await route.params;
    const path = parts.join("/"),
      method = request.method,
      url = new URL(request.url);
    const pagination = {
      page: z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(url.searchParams.get("page") ?? 1),
      pageSize: z.coerce
        .number()
        .int()
        .min(1)
        .max(500)
        .parse(url.searchParams.get("limit") ?? 25),
      search: url.searchParams.get("search")?.slice(0, 120),
    };
    if (path === "system/setup" && method === "GET")
      return ok({ configured: isConfigured() });
    if (path === "auth/register" && method === "POST")
      return await registerWorkspace(request);
    if (path === "auth/verify-email" && method === "POST")
      return await verifySignupEmail(request);
    if (path === "auth/resend-verification" && method === "POST")
      return await resendSignupEmail(request);
    if (path === "branding" && method === "GET") {
      if (!isConfigured())
        return ok({
          platform_name: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel",
        });
      const result = await serviceDatabase()
        .from("system_settings")
        .select("value")
        .eq("key", "branding")
        .maybeSingle();
      databaseError(result.error);
      return ok({
        platform_name:
          result.data?.value?.platform_name ??
          process.env.NEXT_PUBLIC_PLATFORM_NAME ??
          "Voixel",
      });
    }
    if (path === "auth/login-event" && method === "POST") {
      const db = await serverDatabase();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) throw new AppError("UNAUTHORIZED", 401);
      databaseError(
        (
          await serviceDatabase()
            .from("login_history")
            .insert({ user_id: user.id, event: "authenticated_session" })
        ).error,
      );
      return ok({ recorded: true });
    }
    if (path === "me" && method === "GET") {
      const db = await serverDatabase();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) throw new AppError("UNAUTHORIZED", 401);
      const result = await db.rpc("my_context");
      databaseError(result.error);
      if (!result.data) throw new AppError("FORBIDDEN", 403);
      return ok(result.data);
    }
    const admin = parts[0] === "admin";
    const scopedWorkspace =
      admin ||
      ["company", "manager", "team-leader", "agent", "client"].includes(
        parts[0],
      );
    const section = scopedWorkspace ? (parts[1] ?? "dashboard") : parts[0];
    const permissionMap = {
      companies: "companies.manage",
      clients: "users.manage",
      assignees: "numbers.manage",
      providers: "providers.manage",
      numbers: "numbers.manage",
      "number-orders": "numbers.manage",
      users: "users.manage",
      teams: "teams.manage",
      departments: "teams.manage",
      wallets: "finance.read",
      wallet: "finance.read",
      "client-balances": "finance.read",
      billing: "finance.read",
      pricing: "pricing.manage",
      "audit-logs": "audit.read",
      settings: "settings.manage",
      calls: "calls.read",
      reports: "calls.read",
      notifications: "calls.read",
      dashboard: "calls.read",
    } as const;
    const auth = admin
      ? await administrator(
          permissionMap[section as keyof typeof permissionMap] ?? "calls.read",
        )
      : await authenticated();
    const { db, context } = auth;
    if (
      context.membership?.role === "client" &&
      ![
        "dashboard",
        "calls",
        "numbers",
        "reports",
        "notifications",
        "wallet",
      ].includes(section) &&
      !["profile", "favorites", "dialer/identities"].includes(path)
    )
      throw new AppError("FORBIDDEN", 403);
    if (!admin && !context.platform_role && !context.membership)
      throw new AppError("FORBIDDEN", 403);
    // service role is used only after the relevant platform permission is checked above.
    const readDb = admin ? serviceDatabase() : db;
    const companyId = context.membership?.company_id;
    const isSuper = context.platform_role === "super_admin";
    if (
      isDemoData() &&
      (path === "calls/click2call" ||
        path === "numbers/available-countries" ||
        path === "numbers/price-groups" ||
        (admin && parts[1] === "providers" && method !== "GET"))
    )
      throw new AppError("DEMO_PROVIDER_DISABLED", 409);
    const id = parts[2];
    const selectedCompany =
      admin && url.searchParams.get("company")
        ? uuid.parse(url.searchParams.get("company"))
        : undefined;
    const from = url.searchParams.get("from"),
      to = url.searchParams.get("to");
    const callFilters = {
      ...pagination,
      order: "started_at",
      searchColumn: "destination",
      ...(from ? { from: z.iso.datetime().parse(from) } : {}),
      ...(to ? { to: z.iso.datetime().parse(to) } : {}),
      ...(url.searchParams.get("status")
        ? {
            status: z
              .enum(["answer", "busy", "noanswer", "cancel", "failed"])
              .parse(url.searchParams.get("status")),
          }
        : {}),
      ...(admin && url.searchParams.get("company")
        ? { companyId: uuid.parse(url.searchParams.get("company")) }
        : {}),
      ...(admin &&
      hasPermission(context, "providers.manage") &&
      url.searchParams.get("provider")
        ? { provider: uuid.parse(url.searchParams.get("provider")) }
        : {}),
    };
    if (method !== "GET") {
      const limiter = await serviceDatabase().rpc("consume_rate_limit", {
        p_key: `mutation:${context.id}`,
        p_limit: 60,
        p_seconds: 60,
      });
      databaseError(limiter.error);
      if (!limiter.data) throw new AppError("RATE_LIMITED", 429);
    }

    if (section === "dashboard" && method === "GET") {
      if (
        admin &&
        (!hasPermission(context, "companies.manage") ||
          !hasPermission(context, "providers.manage") ||
          !hasPermission(context, "users.manage"))
      )
        throw new AppError("FORBIDDEN", 403);
      const days = z.coerce
        .number()
        .int()
        .min(1)
        .max(90)
        .parse(url.searchParams.get("days") ?? 7);
      return ok(
        await dashboard(
          readDb,
          admin,
          hasPermission(context, "finance.read"),
          days,
          context.client?.id,
        ),
      );
    }
    if (
      section === "client-balances" ||
      (context.membership?.role === "client" && section === "wallet")
    ) {
      if (method === "GET") {
        if (!admin && !context.client) throw new AppError("FORBIDDEN", 403);
        const selectedClient = admin
          ? id
            ? uuid.parse(id)
            : url.searchParams.has("client")
              ? uuid.parse(url.searchParams.get("client"))
              : null
          : context.client!.id;
        const result = await db.rpc("client_balance_overview", {
          p_client: selectedClient,
          p_company: admin ? (selectedCompany ?? null) : companyId,
        });
        databaseError(result.error);
        return ok(result.data);
      }
      if (!admin || !id) throw new AppError("FORBIDDEN", 403);
      if (method === "POST" && parts[3] === "adjust") {
        if (!hasPermission(context, "finance.write"))
          throw new AppError("FORBIDDEN", 403);
        const input = await body(
          request,
          z
            .object({
              type: z.enum(["set", "credit", "debit"]),
              amount: money,
              idempotency_key: z.string().min(8).max(200),
              reason: z.string().trim().min(3).max(500),
            })
            .strict(),
        );
        const result = await db.rpc("adjust_client_balance", {
          p_client: uuid.parse(id),
          p_type: input.type,
          p_amount: input.amount,
          p_key: input.idempotency_key,
          p_reason: input.reason,
        });
        databaseError(result.error);
        return ok(result.data);
      }
      if (method === "POST" && parts[3] === "rate") {
        if (!hasPermission(context, "pricing.manage"))
          throw new AppError("FORBIDDEN", 403);
        const input = await body(
          request,
          z.object({ per_minute: money }).strict(),
        );
        const result = await db.rpc("set_client_germany_rate", {
          p_client: uuid.parse(id),
          p_per_minute: input.per_minute,
        });
        databaseError(result.error);
        return ok({ id: result.data });
      }
    }
    if (section === "clients") {
      if (!hasPermission(context, "users.manage"))
        throw new AppError("FORBIDDEN", 403);
      if (method === "GET") {
        const result = await db.rpc("list_clients", {
          p_company: admin ? (selectedCompany ?? null) : companyId,
          p_search: pagination.search ?? "",
          p_page: pagination.page,
          p_limit: pagination.pageSize,
        });
        databaseError(result.error);
        return ok(result.data.rows, {
          total: result.data.total,
          page: pagination.page,
          pageSize: pagination.pageSize,
        });
      }
      if (method === "PATCH" && id) {
        const data = await body(request, clientAccountSchema);
        const clientId = uuid.parse(id);
        if (admin)
          return ok(
            await updateClientAccount(
              serviceDatabase(),
              context,
              clientId,
              data,
            ),
          );
        if (data.email !== undefined || data.password !== undefined)
          throw new AppError("FORBIDDEN", 403);
        const result = await db.rpc("update_client", {
          p_client: clientId,
          p_name: data.name,
          p_active: data.active,
        });
        databaseError(result.error);
        return ok({ id: result.data });
      }
      if (method === "POST" && !id) {
        const data = await body(
          request,
          z
            .object({
              company_id: uuid.optional(),
              name: z.string().trim().min(2).max(100),
              email: z.email().transform((value) => value.toLowerCase()),
              password: z.string().min(8).max(128),
            })
            .strict(),
        );
        const target = admin ? data.company_id : companyId;
        if (!target) throw new AppError("INVALID_REQUEST");
        const company = await db
          .from("companies")
          .select("id,status,is_seed")
          .eq("id", target)
          .maybeSingle();
        databaseError(company.error);
        if (
          !company.data ||
          !["active", "trial"].includes(company.data.status) ||
          company.data.is_seed !== isDemoData()
        )
          throw new AppError("COMPANY_INACTIVE", 409);
        const service = serviceDatabase();
        const invitation = await service
          .from("user_invitations")
          .insert({
            company_id: target,
            email: data.email,
            role: "client",
            invited_by: context.id,
          })
          .select("id")
          .single();
        databaseError(invitation.error);
        const created = await service.auth.admin.createUser({
          email: data.email,
          password: data.password,
          email_confirm: true,
          user_metadata: {
            full_name: data.name,
            invitation_id: invitation.data!.id,
          },
        });
        if (created.error || !created.data.user) {
          await service
            .from("user_invitations")
            .delete()
            .eq("id", invitation.data!.id);
          throw new AppError("CLIENT_CREATION_FAILED", 409);
        }
        databaseError(
          (
            await service.from("audit_logs").insert({
              actor_id: context.id,
              company_id: target,
              action: "client.created",
              resource_id: created.data.user.id,
            })
          ).error,
        );
        return ok({ user_id: created.data.user.id }, undefined, 201);
      }
    }
    if (admin && section === "companies") {
      if (method === "GET") {
        if (id) {
          const result = await readDb
            .from("companies")
            .select("*,clients(count)")
            .eq("is_seed", isDemoData())
            .eq("id", uuid.parse(id))
            .maybeSingle();
          databaseError(result.error);
          if (!result.data) throw new AppError("NOT_FOUND", 404);
          return ok(result.data);
        }
        const result = await queryRows(
          readDb,
          "companies",
          "*,clients(count)",
          {
            ...pagination,
            searchColumn: "name",
          },
        );
        return ok(result.rows, result);
      }
      if (method === "POST" && !id) {
        const data = await body(
          request,
          z
            .object({
              name: z.string().min(2).max(160),
              contact_email: z.email().nullable().optional(),
              country: z.string().min(2).max(80).nullable().optional(),
              currency,
              slug: z
                .string()
                .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
                .min(2)
                .max(80),
            })
            .strict(),
        );
        const result = await db.rpc("create_company", {
          p_name: data.name,
          p_slug: data.slug,
          p_email: data.contact_email ?? null,
          p_country: data.country ?? null,
          p_currency: data.currency,
          p_is_seed: isDemoData(),
        });
        databaseError(result.error);
        return ok({ id: result.data }, undefined, 201);
      }
      if (method === "PATCH" && id) {
        const data = await body(
          request,
          z
            .object({
              name: z.string().min(2).max(160).optional(),
              status: z
                .enum(["active", "trial", "suspended", "closed"])
                .optional(),
              contact_email: z.email().nullable().optional(),
              allowed_country_prefixes: z
                .array(z.string().regex(/^[1-9]\d{0,3}$/))
                .max(200)
                .optional(),
            })
            .strict(),
        );
        const result = await readDb
          .from("companies")
          .update(data)
          .eq("id", uuid.parse(id))
          .select("id")
          .single();
        databaseError(result.error);
        databaseError(
          (
            await readDb.from("audit_logs").insert({
              actor_id: context.id,
              company_id: id,
              action: "company.updated",
              resource_id: id,
              metadata: data,
            })
          ).error,
        );
        return ok(result.data);
      }
    }
    if (admin && section === "providers") {
      if (method === "GET") {
        const result = await readDb
          .from("provider_accounts")
          .select(
            "*,did_numbers(count),provider_users(count),provider_devices(count)",
          )
          .eq("is_seed", isDemoData())
          .order("created_at");
        databaseError(result.error);
        return ok(result.data);
      }
      if (method === "POST" && !id) {
        const data = await body(
          request,
          z
            .object({
              name: z.string().min(2).max(100),
              currency,
              api_key: z.string().min(16).max(4096),
            })
            .strict(),
        );
        const providerId = crypto.randomUUID();
        const result = await db.rpc("create_provider", {
          p_id: providerId,
          p_name: data.name,
          p_currency: data.currency,
          p_ciphertext: encryptCredential(data.api_key, providerId),
        });
        databaseError(result.error);
        return ok(
          { id: providerId, status: "pending_verification" },
          undefined,
          201,
        );
      }
      if (id && method === "PATCH") {
        const data = await body(
          request,
          z
            .object({
              name: z.string().min(2).max(100).optional(),
              status: z.enum(["disabled", "pending_verification"]).optional(),
              api_key: z.string().min(16).max(4096).optional(),
            })
            .strict(),
        );
        uuid.parse(id);
        if (data.api_key)
          databaseError(
            (
              await db.rpc("set_provider_secret", {
                p_id: id,
                p_ciphertext: encryptCredential(data.api_key, id),
              })
            ).error,
          );
        const update = {
          ...(data.name ? { name: data.name } : {}),
          ...(data.status ? { status: data.status } : {}),
        };
        if (Object.keys(update).length)
          databaseError(
            (await readDb.from("provider_accounts").update(update).eq("id", id))
              .error,
          );
        databaseError(
          (
            await readDb.from("audit_logs").insert({
              actor_id: context.id,
              action: "provider.updated",
              resource_id: id,
            })
          ).error,
        );
        return ok({ updated: true });
      }
      if (id && parts[3] === "test" && method === "POST") {
        const client = await providerClient(uuid.parse(id));
        const result = await client.balance();
        databaseError(
          (
            await readDb
              .from("provider_accounts")
              .update({
                balance: result.balance,
                credit: result.credit,
                credit_limit: result.credit_limit,
                balance_updated_at: new Date().toISOString(),
              })
              .eq("id", id)
          ).error,
        );
        databaseError(
          (
            await readDb.from("audit_logs").insert({
              actor_id: context.id,
              action: "provider.connection_tested",
              resource_id: id,
            })
          ).error,
        );
        return ok({
          connected: true,
          balance: result.balance,
          currencySource: "configured_account_currency",
        });
      }
      if (id && parts[3] === "sync" && method === "POST") {
        const result = await db.rpc("enqueue_provider_sync", {
          p_id: uuid.parse(id),
        });
        databaseError(result.error);
        return ok({ enqueued: result.data }, undefined, 202);
      }
      if (id && parts[3] === "activity" && method === "GET") {
        const result = await readDb
          .from("provider_api_syncs")
          .select("*")
          .eq("provider_account_id", uuid.parse(id))
          .order("started_at", { ascending: false })
          .limit(100);
        databaseError(result.error);
        return ok(result.data);
      }
    }
    if (section === "numbers" && scopedWorkspace) {
      if (method === "GET") {
        if (!admin) {
          let numberQuery = db
            .rpc("my_numbers", {}, { count: "exact" })
            .order("number")
            .range(
              (pagination.page - 1) * pagination.pageSize,
              pagination.page * pagination.pageSize - 1,
            );
          if (pagination.search)
            numberQuery = numberQuery.ilike(
              "number",
              `%${pagination.search.replace(/[%_\\]/g, "")}%`,
            );
          const result = await numberQuery;
          databaseError(result.error);
          return ok(result.data, {
            total: result.count ?? 0,
            page: pagination.page,
            pageSize: pagination.pageSize,
          });
        }
        if (selectedCompany) {
          const result = await db.rpc("company_numbers", {
            p_company: selectedCompany,
            p_search: pagination.search ?? "",
            p_page: pagination.page,
            p_limit: pagination.pageSize,
          });
          databaseError(result.error);
          return ok(result.data.rows, {
            total: result.data.total,
            page: pagination.page,
            pageSize: pagination.pageSize,
          });
        }
        const allocationJoin = "did_allocations";
        const result = await queryRows(
          readDb,
          "did_numbers",
          `${isSuper ? "*" : "id,number,country,provider_status,synced_at"},provider_accounts(company_id),${allocationJoin}(id,company_id,user_id,monthly_price,valid_to,companies(name))`,
          {
            ...pagination,
            order: "synced_at",
            searchColumn: "number",
            companyId: selectedCompany,
            companyColumn: "did_allocations.company_id",
          },
        );
        return ok(result.rows, result);
      }
      if (admin && method === "POST" && id && parts[3] === "assign") {
        const data = await body(
          request,
          z
            .object({
              company_id: uuid,
              user_id: uuid.nullable().default(null),
              monthly_price: money,
            })
            .strict(),
        );
        const result = await db.rpc("allocate_did", {
          p_did: uuid.parse(id),
          p_company: data.company_id,
          p_user: data.user_id,
          p_price: data.monthly_price,
        });
        databaseError(result.error);
        return ok({ allocationId: result.data });
      }
      if (admin && method === "POST" && id && parts[3] === "unassign") {
        databaseError(
          (await db.rpc("unallocate_did", { p_did: uuid.parse(id) })).error,
        );
        return ok({ unassigned: true });
      }
    }
    if (
      section === "numbers" &&
      method === "POST" &&
      id &&
      parts[3] === "client"
    ) {
      if (!hasPermission(context, "numbers.manage"))
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z.object({ client_id: uuid.nullable() }).strict(),
      );
      const result = await db.rpc("assign_number_client", {
        p_did: uuid.parse(id),
        p_client: data.client_id,
      });
      databaseError(result.error);
      return ok({ allocationId: result.data });
    }
    if (
      section === "numbers" &&
      method === "POST" &&
      id &&
      parts[3] === "employee"
    ) {
      const data = await body(request, z.object({ user_id: uuid }).strict());
      const result = await db.rpc("assign_number_employee", {
        p_did: uuid.parse(id),
        p_user: data.user_id,
      });
      databaseError(result.error);
      return ok({ allocationId: result.data });
    }
    if (section === "calls" && method === "GET") {
      if (!hasPermission(context, "calls.read"))
        throw new AppError("FORBIDDEN", 403);
      const callId = scopedWorkspace ? id : parts[1];
      if (callId && callId !== "export") {
        const result = await readDb
          .from("calls")
          .select(isSuper ? "*" : safeCallColumns)
          .eq("is_seed", isDemoData())
          .eq("id", uuid.parse(callId))
          .maybeSingle();
        databaseError(result.error);
        if (!result.data) throw new AppError("NOT_FOUND", 404);
        const call = result.data as unknown as Record<string, unknown>;
        const client = call.user_id
          ? await readDb
              .from("clients")
              .select("id")
              .eq("user_id", call.user_id)
              .maybeSingle()
          : null;
        databaseError(client?.error ?? null);
        return ok({ ...call, client_billing: Boolean(client?.data) });
      }
      const exportFormat = url.searchParams.get("format");
      if (callId === "export" || exportFormat) {
        if (!hasPermission(context, "reports.export"))
          throw new AppError("FORBIDDEN", 403);
        const exported = await db.rpc("export_calls", {
          p_from: callFilters.from ?? "1970-01-01T00:00:00Z",
          p_to: callFilters.to ?? new Date().toISOString(),
          p_status: callFilters.status ?? null,
          p_company: selectedCompany ?? null,
          p_search: pagination.search?.replace(/[%_\\]/g, "") || null,
        });
        databaseError(exported.error);
        const result = exported.data as {
          rows: Record<string, unknown>[];
          total: number;
        };
        const { exportCalls } = await import("@/lib/reports/export");
        databaseError(
          (
            await serviceDatabase()
              .from("audit_logs")
              .insert({
                actor_id: context.id,
                company_id: companyId ?? null,
                action: "calls.exported",
                metadata: {
                  count: result.total,
                  format: exportFormat ?? "csv",
                },
              })
          ).error,
        );
        return exportCalls(
          result.rows,
          exportFormat === "xlsx" ? "xlsx" : "csv",
          isDemoData(),
        );
      }
      const result = await queryRows(
        readDb,
        "calls",
        isSuper
          ? `${safeCallColumns},provider_account_id,provider_resource_id,provider_cost`
          : safeCallColumns,
        callFilters,
      );
      const userIds = [
        ...new Set(
          result.rows
            .map((row) => row.user_id)
            .filter((value): value is string => typeof value === "string"),
        ),
      ];
      const clients = userIds.length
        ? await readDb.from("clients").select("user_id").in("user_id", userIds)
        : null;
      databaseError(clients?.error ?? null);
      const clientUsers = new Set(clients?.data?.map((c) => c.user_id));
      return ok(
        result.rows.map((row) => ({
          ...row,
          client_billing: clientUsers.has(row.user_id),
        })),
        result,
      );
    }
    if ((section === "wallets" || section === "wallet") && method === "GET") {
      if (!hasPermission(context, "finance.read"))
        throw new AppError("FORBIDDEN", 403);
      let walletQuery = readDb
        .from("customer_wallets")
        .select("*,companies(name)")
        .eq("is_seed", isDemoData());
      let transactionQuery = readDb
        .from("wallet_transactions")
        .select("*")
        .eq("is_seed", isDemoData())
        .order("created_at", { ascending: false })
        .limit(100);
      if (selectedCompany) {
        walletQuery = walletQuery.eq("company_id", selectedCompany);
        transactionQuery = transactionQuery.eq("company_id", selectedCompany);
      }
      const wallets = await walletQuery;
      databaseError(wallets.error);
      const transactions = await transactionQuery;
      databaseError(transactions.error);
      return ok({ wallets: wallets.data, transactions: transactions.data });
    }
    if (
      admin &&
      section === "wallets" &&
      method === "POST" &&
      id &&
      parts[3] === "reverse"
    ) {
      if (!hasPermission(context, "finance.write"))
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z
          .object({
            idempotency_key: z.string().min(8).max(200),
            reason: z.string().min(3).max(500),
          })
          .strict(),
      );
      const result = await db.rpc("reverse_wallet_transaction", {
        p_transaction: uuid.parse(id),
        p_key: data.idempotency_key,
        p_reason: data.reason,
      });
      databaseError(result.error);
      return ok({ id: result.data });
    }
    if (
      admin &&
      section === "wallets" &&
      method === "POST" &&
      id &&
      ["credit", "debit"].includes(parts[3])
    ) {
      if (!hasPermission(context, "finance.write"))
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z
          .object({
            amount: money,
            reason: z.string().min(3).max(500),
            idempotency_key: z.string().min(8).max(200),
          })
          .strict(),
      );
      const result = await db.rpc("wallet_post", {
        p_wallet: uuid.parse(id),
        p_amount: `${parts[3] === "debit" ? "-" : ""}${data.amount}`,
        p_type: parts[3],
        p_key: data.idempotency_key,
        p_reason: data.reason,
      });
      databaseError(result.error);
      return ok(result.data);
    }
    if (section === "pricing" && admin) {
      if (method === "GET") {
        const result = await readDb
          .from("pricing_plans")
          .select(
            "*,companies(name),pricing_plan_versions(*,destination_rates(*))",
          )
          .eq("is_seed", isDemoData())
          .order("created_at", { ascending: false });
        databaseError(result.error);
        return ok(result.data);
      }
      if (method === "POST") {
        const data = await body(
          request,
          z
            .object({
              company_id: uuid,
              name: z.string().min(2).max(100),
              currency,
              rates: z
                .array(
                  z
                    .object({
                      prefix: z.string().regex(/^[1-9]\d{0,14}$/),
                      per_minute: money,
                      connection_fee: money,
                      minimum_seconds: z.number().int().min(0).max(3600),
                      increment_seconds: z.number().int().min(1).max(3600),
                    })
                    .strict(),
                )
                .min(1)
                .max(500),
            })
            .strict(),
        );
        const result = await db.rpc("create_pricing_version", {
          p_company: data.company_id,
          p_name: data.name,
          p_currency: data.currency,
          p_rates: data.rates,
        });
        databaseError(result.error);
        return ok({ id: result.data }, undefined, 201);
      }
    }
    if (
      admin &&
      section === "calls" &&
      method === "POST" &&
      id &&
      parts[3] === "rate"
    ) {
      if (!hasPermission(context, "finance.write"))
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z
          .object({ version_id: uuid, confirmed_final: z.literal(true) })
          .strict(),
      );
      const result = await db.rpc("rate_call", {
        p_call: uuid.parse(id),
        p_version: data.version_id,
      });
      databaseError(result.error);
      return ok({ chargeId: result.data });
    }
    if (section === "billing") {
      if (!hasPermission(context, "finance.read"))
        throw new AppError("FORBIDDEN", 403);
      if (method === "GET" && id && parts[3] === "pdf") {
        const invoice = await readDb
          .from("invoices")
          .select("*,companies(name,billing_address,tax_id),invoice_items(*)")
          .eq("is_seed", isDemoData())
          .eq("id", uuid.parse(id))
          .maybeSingle();
        databaseError(invoice.error);
        if (!invoice.data) throw new AppError("NOT_FOUND", 404);
        const { invoicePdf } = await import("@/lib/reports/invoice");
        const file = await invoicePdf(invoice.data);
        return new NextResponse(new Uint8Array(file), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="invoice${isDemoData() ? "-demo" : ""}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      }
      if (method === "GET") {
        const result = await queryRows(
          readDb,
          "invoices",
          "*,companies(name)",
          { ...pagination, companyId: selectedCompany, searchColumn: "number" },
        );
        return ok(result.rows, result);
      }
      if (admin && method === "POST") {
        if (!hasPermission(context, "finance.write"))
          throw new AppError("FORBIDDEN", 403);
        if (id && parts[3] === "payment") {
          const data = await body(
            request,
            z
              .object({
                amount: money,
                currency,
                reference: z.string().min(6).max(200),
                confirmed_received: z.literal(true),
              })
              .strict(),
          );
          const result = await db.rpc("record_payment", {
            p_invoice: uuid.parse(id),
            p_amount: data.amount,
            p_currency: data.currency,
            p_reference: data.reference,
          });
          databaseError(result.error);
          return ok({ id: result.data });
        }
        const data = await body(
          request,
          z
            .object({
              company_id: uuid,
              currency,
              period_start: z.iso.date(),
              period_end: z.iso.date(),
              due_at: z.iso.date(),
              items: z
                .array(
                  z
                    .object({
                      description: z.string().min(2).max(200),
                      quantity: money,
                      unit_price: money,
                      tax_percent: money,
                    })
                    .strict(),
                )
                .min(1)
                .max(100),
            })
            .strict(),
        );
        const result = await db.rpc("issue_invoice", {
          p_company: data.company_id,
          p_currency: data.currency,
          p_start: data.period_start,
          p_end: data.period_end,
          p_due: data.due_at,
          p_items: data.items,
        });
        databaseError(result.error);
        return ok({ id: result.data }, undefined, 201);
      }
    }
    if (
      ["users", "employees", "assignees"].includes(section) &&
      method === "GET"
    ) {
      if (
        !hasPermission(
          context,
          section === "assignees" ? "numbers.manage" : "users.manage",
        )
      )
        throw new AppError("FORBIDDEN", 403);
      const result = await queryRows(
        readDb,
        "company_memberships",
        "*,profiles!company_memberships_user_id_fkey!inner(id,full_name,local_status),companies(name)",
        {
          ...pagination,
          companyId: selectedCompany,
          searchColumn: "profiles.full_name",
          order: "role",
          ...(section === "assignees" ? {} : { excludeRole: "client" }),
        },
      );
      return ok(result.rows, result);
    }
    if (section === "users" && method === "PATCH" && id) {
      if (!hasPermission(context, "users.manage"))
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z
          .object({
            company_id: uuid.optional(),
            department_id: uuid.nullable(),
            team_id: uuid.nullable(),
            manager_id: uuid.nullable(),
            team_leader_id: uuid.nullable(),
            active: z.boolean(),
          })
          .strict(),
      );
      const target = admin ? data.company_id : companyId;
      if (!target) throw new AppError("INVALID_REQUEST");
      const result = await db.rpc("reassign_employee", {
        p_company: target,
        p_user: uuid.parse(id),
        p_department: data.department_id,
        p_team: data.team_id,
        p_manager: data.manager_id,
        p_leader: data.team_leader_id,
        p_active: data.active,
      });
      databaseError(result.error);
      return ok({ updated: true });
    }
    if (
      (section === "users" || section === "employees") &&
      method === "POST" &&
      (parts.includes("invite") || !id)
    ) {
      if (isDemoData()) throw new AppError("DEMO_EMAIL_DISABLED", 409);
      if (!hasPermission(context, "users.manage"))
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z
          .object({
            company_id: uuid.optional(),
            email: z.email(),
            full_name: z.string().min(2).max(100),
            role: z.enum(["company_admin", "manager", "team_leader", "agent"]),
          })
          .strict(),
      );
      const target = admin ? data.company_id : companyId;
      if (!target) throw new AppError("INVALID_REQUEST");
      const service = serviceDatabase();
      const company = await service
        .from("companies")
        .select("id,status")
        .eq("id", target)
        .in("status", ["active", "trial"])
        .maybeSingle();
      databaseError(company.error);
      if (!company.data) throw new AppError("COMPANY_INACTIVE", 409);
      // Invitation is stored first; the auth insert trigger rejects unknown signups and creates membership atomically.
      const invitation = await service
        .from("user_invitations")
        .insert({
          company_id: target,
          email: data.email.toLowerCase(),
          role: data.role,
          invited_by: context.id,
        })
        .select("id")
        .single();
      databaseError(invitation.error);
      const invite = await service.auth.admin.inviteUserByEmail(data.email, {
        redirectTo: `${process.env.APP_URL}/auth/callback?next=/auth/password`,
        data: { full_name: data.full_name, invitation_id: invitation.data!.id },
      });
      if (invite.error) {
        await service
          .from("user_invitations")
          .delete()
          .eq("id", invitation.data!.id);
        throw new AppError(
          "INVALID_REQUEST",
          409,
          "Invitation could not be sent. The address may already have an account.",
        );
      }
      databaseError(
        (
          await service.from("audit_logs").insert({
            company_id: target,
            actor_id: context.id,
            action: "user.invited",
            resource_id: invitation.data!.id,
          })
        ).error,
      );
      return ok({ invited: true }, undefined, 201);
    }
    if (
      (section === "teams" || section === "departments") &&
      method === "GET"
    ) {
      const result = await queryRows(
        readDb,
        section === "teams" ? "teams" : "company_departments",
        "*",
        {
          ...pagination,
          companyId: selectedCompany,
          searchColumn: "name",
          order: "name",
        },
      );
      return ok(result.rows, result);
    }
    if (
      (section === "teams" || section === "departments") &&
      method === "POST"
    ) {
      if (!hasPermission(context, "teams.manage"))
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z
          .object({
            name: z.string().min(2).max(100),
            company_id: uuid.optional(),
          })
          .strict(),
      );
      const target = admin ? data.company_id : companyId;
      if (!target) throw new AppError("INVALID_REQUEST");
      const result = await serviceDatabase()
        .from(section === "teams" ? "teams" : "company_departments")
        .insert({ company_id: target, name: data.name })
        .select("id")
        .single();
      databaseError(result.error);
      databaseError(
        (
          await serviceDatabase()
            .from("audit_logs")
            .insert({
              company_id: target,
              actor_id: context.id,
              action: `${section}.created`,
              resource_id: result.data!.id,
            })
        ).error,
      );
      return ok(result.data, undefined, 201);
    }
    if (
      (section === "notifications" || path === "notifications") &&
      method === "GET"
    ) {
      const result = await queryRows(readDb, "notifications", "*", {
        ...pagination,
        searchColumn: "title",
      });
      return ok(result.rows, result);
    }
    if (
      (section === "audit-logs" || path === "audit-logs") &&
      method === "GET"
    ) {
      if (
        !hasPermission(context, "audit.read") &&
        context.membership?.role !== "company_admin"
      )
        throw new AppError("FORBIDDEN", 403);
      const result = await queryRows(readDb, "audit_logs", "*", {
        ...pagination,
        companyId: selectedCompany,
        searchColumn: "action",
      });
      return ok(result.rows, result);
    }
    if (section === "reports" && method === "GET") {
      const result = await queryRows(
        readDb,
        "calls",
        isSuper ? `${safeCallColumns},provider_cost` : safeCallColumns,
        { ...callFilters, page: 1, pageSize: 1000 },
      );
      return ok({
        calls: result.rows,
        sampled: result.total > 1000,
        total: result.total,
      });
    }
    if (section === "settings" && admin) {
      if (method === "GET") {
        const result = await readDb.from("system_settings").select("*");
        databaseError(result.error);
        return ok(result.data);
      }
      if (method === "POST") {
        const data = await body(
          request,
          z
            .object({
              platform_name: z.string().min(2).max(60),
              support_email: z.email(),
              timezone: z.string().max(80),
              default_currency: currency,
            })
            .strict(),
        );
        databaseError(
          (
            await readDb.from("system_settings").upsert({
              key: "branding",
              value: data,
              updated_at: new Date().toISOString(),
            })
          ).error,
        );
        databaseError(
          (
            await readDb
              .from("audit_logs")
              .insert({ actor_id: context.id, action: "settings.updated" })
          ).error,
        );
        return ok({ saved: true });
      }
    }
    if (section === "number-orders" && method === "GET") {
      const result = await queryRows(
        readDb,
        "did_orders",
        admin ? "*" : "id,company_id,status,country,quantity,created_at",
        { ...pagination, searchColumn: "country", companyId: selectedCompany },
      );
      return ok(result.rows, result);
    }
    if (path === "numbers/requests" && method === "POST") {
      const data = await body(
        request,
        z
          .object({
            country: z.string().min(2).max(80),
            quantity: z.number().int().min(1).max(100),
          })
          .strict(),
      );
      if (!companyId || context.membership?.role !== "company_admin")
        throw new AppError("FORBIDDEN", 403);
      const result = await serviceDatabase()
        .from("did_orders")
        .insert({ company_id: companyId, ...data, status: "draft" })
        .select("id")
        .single();
      databaseError(result.error);
      return ok(result.data, undefined, 201);
    }
    if (
      ["numbers/available-countries", "numbers/price-groups"].includes(path) &&
      method === "GET"
    ) {
      await administrator("numbers.manage");
      const providerId = uuid.parse(url.searchParams.get("provider"));
      const client = await providerClient(providerId);
      return ok(
        path.endsWith("price-groups")
          ? await client.priceGroups(
              z.coerce
                .number()
                .int()
                .positive()
                .parse(url.searchParams.get("country")),
            )
          : await client.availableCountries(),
      );
    }
    if (path === "calls/click2call" && method === "POST") {
      if (!hasPermission(context, "calls.initiate") || !companyId)
        throw new AppError("FORBIDDEN", 403);
      const data = await body(
        request,
        z
          .object({
            identity_id: uuid,
            destination: e164,
            idempotency_key: z.string().min(8).max(200),
          })
          .strict(),
      );
      const service = serviceDatabase();
      const limit = await service.rpc("consume_rate_limit", {
        p_key: `call:${context.id}`,
        p_limit: 5,
        p_seconds: 60,
      });
      databaseError(limit.error);
      if (!limit.data) throw new AppError("RATE_LIMITED", 429);
      const permission = await service
        .from("caller_id_permissions")
        .select("*,provider_devices(*),did_allocations(*,did_numbers(*))")
        .eq("id", data.identity_id)
        .eq("company_id", companyId)
        .eq("user_id", context.id)
        .eq("enabled", true)
        .not("verified_at", "is", null)
        .maybeSingle();
      databaseError(permission.error);
      if (!permission.data) throw new AppError("FORBIDDEN", 403);
      const identity = permission.data,
        allocation = identity.did_allocations,
        device = identity.provider_devices;
      if (
        !allocation ||
        !device ||
        allocation.valid_to ||
        allocation.company_id !== companyId ||
        allocation.user_id !== context.id ||
        allocation.did_numbers.provider_account_id !==
          device.provider_account_id ||
        device.application_user_id !== context.id
      )
        throw new AppError("FORBIDDEN", 403);
      const company = await service
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .single();
      databaseError(company.error);
      if (!["active", "trial"].includes(company.data!.status))
        throw new AppError("COMPANY_INACTIVE", 403);
      if (
        !(company.data!.allowed_country_prefixes as string[]).some((prefix) =>
          data.destination.slice(1).startsWith(prefix),
        )
      )
        throw new AppError("FORBIDDEN", 403);
      const wallet = context.client
        ? await service
            .from("client_wallets")
            .select("*")
            .eq("client_id", context.client.id)
            .maybeSingle()
        : await service
            .from("customer_wallets")
            .select("*")
            .eq("company_id", companyId)
            .eq("currency", company.data!.currency)
            .maybeSingle();
      databaseError(wallet.error);
      if (
        (context.client || company.data!.billing_mode === "prepaid") &&
        (!wallet.data ||
          wallet.data.suspended ||
          Number(wallet.data.balance) <=
            Number(wallet.data.minimum_balance ?? 0))
      )
        throw new AppError("INSUFFICIENT_BALANCE", 409);
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            user: context.id,
            identity: data.identity_id,
            destination: data.destination,
          }),
        )
        .digest("hex");
      const claim = await service.from("idempotency_records").insert({
        key: `click2call:${data.idempotency_key}`,
        user_id: context.id,
        company_id: companyId,
        request_hash: hash,
      });
      if (claim.error?.code === "23505") {
        const previous = await service
          .from("idempotency_records")
          .select("*")
          .eq("key", `click2call:${data.idempotency_key}`)
          .single();
        databaseError(previous.error);
        if (
          previous.data!.user_id !== context.id ||
          previous.data!.request_hash !== hash
        )
          throw new AppError("IDEMPOTENCY_CONFLICT", 409);
        if (previous.data!.status !== "submitted")
          throw new AppError("PROVIDER_OUTCOME_UNKNOWN", 409);
        return ok({ submitted: true });
      }
      databaseError(claim.error);
      // No caller_displayname is accepted from clients. Only a manually verified device/DID pairing can be used.
      const client = await providerClient(device.provider_account_id);
      const result = await client.click2call({
        data: {
          caller_number: device.provider_resource_id,
          destination_number: data.destination,
          destination_displayname: data.destination,
        },
      });
      databaseError(
        (
          await service
            .from("idempotency_records")
            .update({ status: "submitted", result })
            .eq("key", `click2call:${data.idempotency_key}`)
        ).error,
      );
      databaseError(
        (
          await service.from("audit_logs").insert({
            company_id: companyId,
            actor_id: context.id,
            action: "click2call.submitted",
            resource_id: data.identity_id,
          })
        ).error,
      );
      return ok(result, undefined, 202);
    }
    if (path === "dialer/identities" && method === "GET") {
      if (isDemoData()) return ok([]);
      if (!companyId || !hasPermission(context, "calls.initiate"))
        return ok([]);
      const result = await serviceDatabase()
        .from("caller_id_permissions")
        .select("id,did_allocations(did_numbers(number))")
        .eq("company_id", companyId)
        .eq("user_id", context.id)
        .eq("enabled", true)
        .not("verified_at", "is", null);
      databaseError(result.error);
      return ok(result.data);
    }
    if (path === "integrations/teltel/webhook")
      throw new AppError("UNSUPPORTED_CAPABILITY", 501);
    if (method === "POST" && path === "profile") {
      const data = await body(
        request,
        z
          .object({
            full_name: z.string().min(2).max(100),
            local_status: z.enum([
              "available",
              "busy",
              "break",
              "lunch",
              "meeting",
              "offline",
            ]),
          })
          .strict(),
      );
      databaseError(
        (
          await serviceDatabase()
            .from("profiles")
            .update(data)
            .eq("id", context.id)
        ).error,
      );
      return ok({ saved: true });
    }
    if (path === "favorites") {
      if (!companyId) throw new AppError("FORBIDDEN", 403);
      if (method === "GET") {
        const result = await db
          .from("favorite_contacts")
          .select("*")
          .eq("is_seed", isDemoData());
        databaseError(result.error);
        return ok(result.data);
      }
      if (method === "POST") {
        const data = await body(
          request,
          z.object({ name: z.string().min(2).max(100), number: e164 }).strict(),
        );
        const result = await serviceDatabase()
          .from("favorite_contacts")
          .insert({ ...data, company_id: companyId, user_id: context.id })
          .select("id")
          .single();
        databaseError(result.error);
        return ok(result.data, undefined, 201);
      }
    }
    throw new AppError("NOT_FOUND", 404);
  } catch (error) {
    return failure(
      error instanceof z.ZodError
        ? new AppError("INVALID_REQUEST", 400)
        : error,
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
