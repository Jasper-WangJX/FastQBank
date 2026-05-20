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

interface Providers {
  google: boolean;
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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [providers, setProviders] = useState<Providers | null>(null);

  const login = useCallback((newToken: string) => {
    persistToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setTokenState(null);
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
        if (!cancelled) setProviders({ google: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: token !== null,
      login,
      logout,
      providers,
    }),
    [token, login, logout, providers],
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
