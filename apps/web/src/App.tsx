import type { ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import QuestionListPage from "./pages/QuestionListPage";
import QuestionFormPage from "./pages/QuestionFormPage";
import ReviewEntryPage from "./pages/ReviewEntryPage";
import ReviewSessionPage from "./pages/ReviewSessionPage";
import QuestionBankVariantA from "./pages/_previews/QuestionBankVariantA";
import QuestionBankVariantB from "./pages/_previews/QuestionBankVariantB";
import QuestionBankVariantC from "./pages/_previews/QuestionBankVariantC";
import QuestionBankVariantD from "./pages/_previews/QuestionBankVariantD";
import QuestionBankVariantE from "./pages/_previews/QuestionBankVariantE";
import QuestionBankVariantF from "./pages/_previews/QuestionBankVariantF";

/** Inverse of RequireAuth: keep an already-logged-in user out of the
 *  login/register pages by bouncing them to the home page. */
function PublicOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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

          {/* Design previews (no auth, no shell) for picking a UI direction. */}
          <Route path="/preview/a" element={<QuestionBankVariantA />} />
          <Route path="/preview/b" element={<QuestionBankVariantB />} />
          <Route path="/preview/c" element={<QuestionBankVariantC />} />
          <Route path="/preview/d" element={<QuestionBankVariantD />} />
          <Route path="/preview/e" element={<QuestionBankVariantE />} />
          <Route path="/preview/f" element={<QuestionBankVariantF />} />
          <Route
            path="/preview"
            element={
              <div className="mx-auto max-w-xl p-10 font-sans">
                <h1 className="mb-4 text-2xl font-semibold tracking-tight">
                  FastQBank — Question Bank UI previews
                </h1>
                <p className="mb-4 text-xs uppercase tracking-[0.18em] text-slate-400">
                  Round 1 · minimalist directions
                </p>
                <ul className="space-y-3 text-sm">
                  <li>
                    <a className="text-sky-600 underline" href="/preview/a">
                      Variant A — Pure White / Apple-clean
                    </a>
                  </li>
                  <li>
                    <a className="text-sky-600 underline" href="/preview/b">
                      Variant B — Soft Pastel / Raycast-bloom
                    </a>
                  </li>
                  <li>
                    <a className="text-sky-600 underline" href="/preview/c">
                      Variant C — Cool Mono / Linear-grid
                    </a>
                  </li>
                </ul>
                <p className="mt-8 mb-4 text-xs uppercase tracking-[0.18em] text-slate-400">
                  Round 2 · white + deep sapphire · tech-leaning, sharper lines
                </p>
                <ul className="space-y-3 text-sm">
                  <li>
                    <a className="text-sky-600 underline" href="/preview/d">
                      Variant D — Sapphire Blueprint (engineering / CAD)
                    </a>
                  </li>
                  <li>
                    <a className="text-sky-600 underline" href="/preview/e">
                      Variant E — Sapphire Console (terminal / IDE)
                    </a>
                  </li>
                  <li>
                    <a className="text-sky-600 underline" href="/preview/f">
                      Variant F — Sapphire Command (aerospace / cockpit)
                    </a>
                  </li>
                </ul>
              </div>
            }
          />

          {/* Authenticated area: one guarded shell, child routes render
              into AppLayout's <Outlet/>. */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            {/* "/" has no page of its own — land on the question bank. */}
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

          {/* Unknown paths -> "/" -> (index) -> /questions. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
