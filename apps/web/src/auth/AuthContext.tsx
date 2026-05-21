import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  UNAUTHORIZED_EVENT,
  apiFetch,
  clearToken,
  getToken,
  setToken as persistToken,
} from "../lib/api";
// `getToken` is used at module init for the AuthProvider's lazy useState
// initializer. The post-login redirect race that previously read it inside
// useAuth() as a tiebreaker is now solved at the router layer
// (BrowserRouter useTransitions={false} in App.tsx) — see comment there.

interface Providers {
  google: { web: boolean; desktop: boolean };
}

interface CurrentUser {
  id: string;
  email: string;
  has_password: boolean;
}

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
  /** Server-side feature flags. Null until the first /auth/providers
   *  fetch resolves; consumers should treat null as "still loading,
   *  hide the optional button for now". */
  providers: Providers | null;
  /** Cached /me. Null while fetching or logged out. Refresh() forces
   *  a re-fetch (e.g. after Settings actions that change has_password
   *  — currently the password reset keeps has_password true, so this
   *  isn't strictly needed today, but provided for hygiene). */
  currentUser: CurrentUser | null;
  refreshCurrentUser: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [providers, setProviders] = useState<Providers | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const login = useCallback((newToken: string) => {
    persistToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setCurrentUser(null);
  }, []);

  const refreshCurrentUser = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setTokenState(null);
      setCurrentUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Providers>("/auth/providers")
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch(() => {
        // Network/CORS error: hide the optional button rather than
        // render a broken control.
        if (!cancelled)
          setProviders({ google: { web: false, desktop: false } });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (token === null) {
      setCurrentUser(null);
      return;
    }
    let cancelled = false;
    apiFetch<CurrentUser>("/me")
      .then((u) => {
        if (!cancelled) setCurrentUser(u);
      })
      .catch(() => {
        // 401 is already handled by the UNAUTHORIZED_EVENT path;
        // for anything else, leave currentUser null and let the UI
        // hide gated features.
        if (!cancelled) setCurrentUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshTick]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: token !== null,
      login,
      logout,
      providers,
      currentUser,
      refreshCurrentUser,
    }),
    [token, login, logout, providers, currentUser, refreshCurrentUser],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
