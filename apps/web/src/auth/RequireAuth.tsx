import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * Route guard. Renders its children only when authenticated; otherwise
 * redirects to /login. `replace` so the Back button doesn't bounce the
 * user back into the guarded page (and then straight out again).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
