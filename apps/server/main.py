from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# The FastAPI application instance. Uvicorn loads this object ("main:app").
app = FastAPI(title="AI Question Bank API")

# CORS: a browser blocks cross-origin requests unless the server opts in.
# The Vite dev server runs on a different origin than this API, so we must
# explicitly allow it, otherwise the front-end fetch() fails.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite default port
        "http://localhost:5174",  # fallback port when 5173 is taken
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health probe. The front-end HealthCheck component calls this on startup
# to confirm the browser -> React -> FastAPI chain works end to end.
@app.get("/health")
def health():
    return {"status": "ok"}
