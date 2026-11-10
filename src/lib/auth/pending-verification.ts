import settings from "./email-verification-settings.json";

const storageKey = "voixel.pending-email-verification";
export function rememberVerification(email: string, resendAfterSeconds = 0) {
  const value = {
    email: email.trim().toLowerCase(),
    resendAvailableAt: Date.now() + resendAfterSeconds * 1000,
  };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Verification still works by entering the email when storage is disabled.
  }
  return value;
}

export function pendingVerification() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (typeof saved?.email !== "string") return null;
    return {
      email: saved.email,
      resendAvailableAt: Math.min(
        Number(saved.resendAvailableAt) || 0,
        Date.now() + settings.resendAfterSeconds * 1000,
      ),
    };
  } catch {
    return null;
  }
}

export function clearVerification() {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Storage is optional; no passwords or verification codes are stored here.
  }
}
