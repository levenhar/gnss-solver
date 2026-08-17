## Run locally (API + worker + Redis)

    docker compose -f docker/docker-compose.yml up --build

Then open http://localhost:8000/docs to submit a job (upload rover/nav files,
paste a config JSON), poll `GET /jobs/{id}`, and fetch `GET /jobs/{id}/result`.
