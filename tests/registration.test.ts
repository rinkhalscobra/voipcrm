import { describe, it, expect } from "vitest";
import { registrationSchema } from "../src/lib/auth/registration-schema";
const input = {
  full_name: "New owner",
  company_name: "New workspace",
  email: "new@example.invalid",
  password: "abcdefgh",
  country: "Germany",
  currency: "EUR",
};
describe("public registration input", () => {
  it("accepts an eight-character password and normalizes names and email", () => {
    const result = registrationSchema.parse({
      ...input,
      full_name: "  New owner  ",
      email: "  NEW@example.invalid  ",
    });
    expect(result.full_name).toBe("New owner");
    expect(result.email).toBe("new@example.invalid");
  });
  it("rejects a password shorter than eight characters", () =>
    expect(
      registrationSchema.safeParse({ ...input, password: "1234567" }).success,
    ).toBe(false));
  it("rejects attempts to select a role or existing company", () => {
    expect(
      registrationSchema.safeParse({ ...input, role: "super_admin" }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({
        ...input,
        company_id: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
  it("rejects empty company names and malformed currencies", () => {
    expect(
      registrationSchema.safeParse({ ...input, company_name: " " }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({ ...input, currency: "EURO" }).success,
    ).toBe(false);
  });
});
