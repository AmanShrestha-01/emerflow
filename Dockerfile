# One Cloud Run service: FastAPI backend + the Next.js site (web/) + the classic app (frontend/, DeepChart).
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-slim AS next
WORKDIR /next
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist frontend/dist
COPY --from=next /next/out web/out
ENV PORT=8080
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT} --timeout-graceful-shutdown 5"]
