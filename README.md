## Run locally (API + worker + Redis)

    docker compose -f docker/docker-compose.yml up --build

Then open http://localhost:8000/docs to submit a job (upload rover/nav files,
paste a config JSON), poll `GET /jobs/{id}`, and fetch `GET /jobs/{id}/result`.

## Web UI

The React frontend is served by the `web` service:

    docker compose -f docker/docker-compose.yml up --build

Open http://localhost:3000 — submit a job (upload rover/nav files, set config),
watch it process, and explore the result on the map + charts. The UI talks to the
API at http://localhost:8000 (set `VITE_API_BASE` build arg to change).

Local frontend dev with hot reload:

    cd web && npm install && npm run dev   # http://localhost:3000
