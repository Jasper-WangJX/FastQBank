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
import TagManagerPage from "./pages/TagManagerPage";
import QuestionListPage from "./pages/QuestionListPage";
import QuestionFormPage from "./pages/QuestionFormPage";

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
            <Route path="/tags" element={<TagManagerPage />} />
            <Route path="/questions" element={<QuestionListPage />} />
            <Route path="/questions/new" element={<QuestionFormPage />} />
            <Route
              path="/questions/:id/edit"
              element={<QuestionFormPage />}
            />
          </Route>

          {/* Unknown paths -> "/" -> (index) -> /questions. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
