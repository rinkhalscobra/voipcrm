export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    message?: string,
  ) {
    super(message ?? code);
  }
}
export const publicMessages: Record<string, string> = {
  EMAIL_IN_USE:
    "That email is already used by another account. Choose a different login email.",
  PASSWORD_REJECTED:
    "Auth rejected this password. Choose a different password with at least 8 characters.",
  CLIENT_UPDATE_FAILED:
    "The client account update could not be confirmed. Refresh the client list and check the login details before trying again.",
  CLIENT_BILLING_MANAGED:
    "Client calls are billed automatically using the client's retail rate and separate balance.",
  INVALID_RATE:
    "Enter a valid non-negative rate with up to six decimal places.",
  CLIENT_COMPANY_MISMATCH:
    "The client and number must belong to the same company.",
  COMPANY_REQUIRED:
    "Allocate this number to a company before removing its client assignment.",
  CLIENT_NUMBER_ASSIGNMENT_REQUIRED:
    "Assign numbers to the client directly. Company account emails are separate from client logins.",
  CLIENT_CREATION_FAILED:
    "The client login could not be created. Check whether that email already has an account.",
  REGISTRATION_FAILED:
    "The account could not be created. If you already have an account, sign in or reset your password.",
  DEMO_PROVIDER_DISABLED:
    "Demo mode is active. Provider requests, real calling, and credential changes are disabled until you switch to live data.",
  DEMO_EMAIL_DISABLED:
    "Demo mode is active. Employee invitation emails are disabled; the sample employees are available for exploration.",
  DATA_MODE_MISMATCH:
    "This record belongs to another data mode. Demo and live records cannot be combined.",
  UNAUTHORIZED: "Sign in to continue.",
  FORBIDDEN: "Your account does not have access to this action.",
  SETUP_REQUIRED:
    "Connect Supabase and apply the database migrations to enable this workspace.",
  NOT_FOUND: "The requested resource is not available.",
  ALLOCATION_CONFLICT: "This number already has an active allocation.",
  INSUFFICIENT_BALANCE: "The wallet has insufficient funds.",
  IDEMPOTENCY_CONFLICT:
    "This request key has already been used for a different operation.",
  PROVIDER_AUTH:
    "The provider rejected the credentials. Replace the key and test again.",
  CREDENTIAL_DECRYPTION_ERROR:
    "Provider credentials could not be decrypted. Check that the web server and worker use the same encryption key.",
  PROVIDER_UNAVAILABLE:
    "The provider is currently unavailable. Try again later.",
  PROVIDER_TIMEOUT: "The provider did not respond within the time limit.",
  PROVIDER_REJECTED:
    "The provider rejected this request. Review the configuration.",
  PROVIDER_SCHEMA:
    "The provider response differs from the documented schema. This action requires review.",
  PROVIDER_OUTCOME_UNKNOWN:
    "The request outcome is unknown. Reconcile with the provider before retrying.",
  RATE_LIMITED: "Too many requests. Please wait before trying again.",
  UNSUPPORTED_CAPABILITY:
    "This capability requires confirmed provider documentation before it can be enabled.",
  FIRST_ACCOUNT_UNVERIFIED:
    "Verify balance, users, devices, DIDs, and calls on the first provider account before adding another account.",
  CURRENCY_MISMATCH:
    "This operation requires matching currencies. No implicit currency conversion is permitted.",
  INVALID_REQUEST: "Check the submitted fields and try again.",
  INTERNAL_ERROR:
    "The operation could not be completed. Use the request ID when contacting support.",
  WALLET_SUSPENDED: "Wallet operations have been suspended.",
  COMPANY_INACTIVE: "This company is not active.",
  INVALID_MEMBER:
    "The selected employee is not an active member of this company.",
  INVALID_PLAN:
    "The pricing version is not valid for this company and call date.",
  NO_DESTINATION_RATE: "No destination rate is configured for this call.",
  CALL_NOT_FINAL:
    "The call needs complete timestamps and verified ownership before billing.",
  CALL_STATUS_REQUIRES_REVIEW:
    "This call status requires manual billing review.",
  WALLET_MISSING: "Create a wallet in the pricing currency first.",
  PAGINATION_LIMIT:
    "The documented provider pagination limit was reached. The synchronization is incomplete and requires review.",
  EXPORT_LIMIT:
    "Select a smaller date range. Exports are limited to 10,000 calls.",
};
export function databaseError(error: { message: string } | null) {
  if (!error) return;
  const code = Object.keys(publicMessages).find((k) =>
    error.message.includes(k),
  );
  throw new AppError(
    code ?? "INTERNAL_ERROR",
    code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : code ? 409 : 500,
  );
}
