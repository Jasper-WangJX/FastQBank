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
