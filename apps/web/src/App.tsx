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
import LandingPage from "./pages/LandingPage";
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
  // Authed users that land on /login or /register are bounced to /
  // (LandingPage), which detects their auth state and surfaces the
  // "OPEN APP →" CTA pointing at /questions.
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
        navigate("/questions", { replace: true });
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
          {/* Public landing page. Renders for every visitor; the
              embedded "ENTER WEB" / "OPEN APP" CTA flips based on the
              current auth state. */}
          <Route path="/" element={<LandingPage />} />

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

          {/* Authenticated app surface. RequireAuth gates each path
              under here; unauth users are redirected to /login. */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
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
