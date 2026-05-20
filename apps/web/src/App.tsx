import { useEffect, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import QuestionListPage from "./pages/QuestionListPage";
import QuestionFormPage from "./pages/QuestionFormPage";
import ReviewEntryPage from "./pages/ReviewEntryPage";
import ReviewSessionPage from "./pages/ReviewSessionPage";
import { getDesktop } from "./lib/desktop";
import { completeOAuthCallback } from "./lib/oauth";

function PublicOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : <>{children}</>;
}

/** Listens for the desktop main-process IPC carrying the OAuth
 *  callback. Lives inside AuthProvider so it can call login(). */
function DesktopOAuthListener() {
  const { login } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;
    const unsubscribe = desktop.oauth.onCallback(async ({ code, state }) => {
      try {
        const token = await completeOAuthCallback(code, state);
        login(token);
        navigate("/", { replace: true });
      } catch (e) {
        console.error("[oauth] callback failed", e);
      }
    });
    return unsubscribe;
  }, [login, navigate]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DesktopOAuthListener />
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <LoginPage />
              </PublicOnly>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnly>
                <RegisterPage />
              </PublicOnly>
            }
          />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/questions" replace />} />
            <Route path="/questions" element={<QuestionListPage />} />
            <Route path="/questions/new" element={<QuestionFormPage />} />
            <Route
              path="/questions/:id/edit"
              element={<QuestionFormPage />}
            />
            <Route path="/review" element={<ReviewEntryPage />} />
            <Route path="/review/session" element={<ReviewSessionPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
