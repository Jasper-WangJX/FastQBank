// Authenticated app shell: top nav + logout, renders the matched child
// route via <Outlet/>. Mounted once under RequireAuth in App.tsx so the
// stage-2 pages share one chrome (and one place for the logout action).

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const linkBase = "rounded-md px-3 py-1.5 text-sm font-medium";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? `${linkBase} bg-slate-800 text-white`
    : `${linkBase} text-gray-600 hover:bg-gray-100`;
}

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Clear the token and bounce to login.
  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <span className="mr-3 text-sm font-semibold">
            AI Question Bank
          </span>
          <nav className="flex items-center gap-1">
            {/* `end` so it isn't kept active on /questions/new. */}
            <NavLink to="/questions" end className={navClass}>
              Question Bank
            </NavLink>
            <NavLink to="/questions/new" className={navClass}>
              New Question
            </NavLink>
            <NavLink to="/tags" className={navClass}>
              Tags
            </NavLink>
          </nav>
          <button
            onClick={onLogout}
            className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
