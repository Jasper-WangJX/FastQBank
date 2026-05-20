// Phase 11.1 — thin wrappers for the three Settings-modal endpoints
// (request reset code, reset password, delete account). Keeps the
// modal JSX free of fetch plumbing.

import { apiFetch } from "./api";

export async function requestPasswordResetCode(): Promise<void> {
  await apiFetch<void>("/auth/request-password-reset-code", {
    method: "POST",
  });
}

export interface ResetPasswordBody {
  code: string;
  new_password: string;
  confirm_password: string;
}

export async function resetPassword(body: ResetPasswordBody): Promise<void> {
  await apiFetch<void>("/auth/reset-password", {
    method: "POST",
    body,
  });
}

export async function deleteAccount(confirm_email: string): Promise<void> {
  await apiFetch<void>("/auth/delete-account", {
    method: "POST",
    body: { confirm_email },
  });
}

// --- Phase 11.2: public forgot-password flow -------------------------------

export async function forgotPassword(email: string): Promise<void> {
  await apiFetch<void>("/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

export interface ResetPasswordPublicBody {
  email: string;
  code: string;
  new_password: string;
  confirm_password: string;
}

export async function resetPasswordPublic(
  body: ResetPasswordPublicBody,
): Promise<void> {
  await apiFetch<void>("/auth/reset-password-public", {
    method: "POST",
    body,
  });
}
