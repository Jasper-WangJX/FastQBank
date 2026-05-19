import { Navigate } from "react-router-dom";

export default function ReviewSessionPage() {
  // Filled in Task 12. Without router state there is no deck — bounce.
  return <Navigate to="/review" replace />;
}
