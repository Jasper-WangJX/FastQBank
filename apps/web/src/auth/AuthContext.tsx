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
  clearToken,
  getToken,
  setToken as persistToken,
} from "../lib/api";

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize straight from localStorage so a full page refresh keeps
  // the user logged in (this is the "刷新后仍登录态" exit criterion).
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const login = useCallback((newToken: string) => {
    persistToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
  }, []);

  // api.ts already clears the token and fires this on any 401
  // (expired/invalid). We just sync React state so the guard redirects.
  useEffect(() => {
    const onUnauthorized = () => setTokenState(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, isAuthenticated: token !== null, login, logout }),
    [token, login, logout],
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
