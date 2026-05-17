# Backend image: FastAPI + Alembic. On start it applies DB migrations,
# then serves uvicorn. Runtime config (DATABASE_URL, JWT_SECRET,
# CORS_ORIGINS, ...) is injected as environment variables by compose;
# settings.py reads them straight from the environment (the repo-root
# .env it computes does not exist in the image, which pydantic-settings
# silently ignores).

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install deps first so the layer is cached unless requirements change.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code + migration tooling (exclusions in .dockerignore).
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .
COPY main.py .

EXPOSE 8000

# Apply migrations, then start the server. `exec` makes uvicorn PID 1 so
# it receives SIGTERM for a graceful shutdown. Migrations run here (not a
# separate job) so a fresh VPS comes up with the schema in one command.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000"]
