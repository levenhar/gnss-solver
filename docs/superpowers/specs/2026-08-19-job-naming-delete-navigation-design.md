# Job/Batch Naming, Delete, and Back Navigation

## Problem

Jobs and batches are only ever identified by their opaque UUID hex ID in the
UI. Users can't label what a job/batch was for, can't clean up old ones from
the list, and have no quick way back to where they came from after drilling
into a job/batch detail page.

## Scope

- Optional user-supplied name at job/batch creation time, shown instead of
  the raw ID everywhere the ID is currently the primary label.
- Rename a job or batch at any time (no status restriction).
- Delete a job or batch from the jobs list.
- A header back button that returns to the previous in-app location.

## Backend

**`api/jobstore.py`**
- `write_name(dir: Path, name: str) -> None` / `read_name(dir: Path) -> str | None`,
  storing `name.json` (`{"name": "..."}`) in the given job/batch dir. Generic
  over the dir since jobs and batches use the same directory-per-entity
  layout.
- Thin wrappers: `write_job_name`/`read_job_name`, `write_batch_name`/`read_batch_name`.

**`api/schemas.py`**
- Add `name: str | None = None` to `JobCreated`, `JobStatusResponse`,
  `JobListItem`, `BatchCreated`, `BatchListItem`.
- New `RenameRequest(BaseModel)` with `name: str`.

**`api/main.py`**
- `POST /jobs` / `POST /batches`: new optional `name: str | None = Form(None)`.
  If provided (non-blank after strip), persisted via jobstore at creation.
- `PATCH /jobs/{id}/name`, `PATCH /batches/{id}/name`: body `RenameRequest`.
  404 if job/batch dir doesn't exist. Rejects blank name (422).
- `DELETE /jobs/{id}`: `jobstore.delete_job`. 404 if not found first.
- `DELETE /batches/{id}`: delete every job dir referenced in the batch
  manifest (same pattern as `cleanup.remove_stale_data`) then the batch dir.
  404 if manifest missing.
- `job_status`/`list_jobs`/`batch_status`/`list_batches` responses include
  `name` by reading it alongside existing status computation.

## Frontend

**`web/src/api/types.ts`**: add `name?: string | null` to `JobCreated`,
`JobListItem`, `JobStatus`, `BatchCreated`, `BatchListItem`, `BatchStatus`.

**`web/src/api/client.ts`**: add `renameJob(id, name)`, `renameBatch(id, name)`,
`deleteJob(id)`, `deleteBatch(id)` — `PATCH`/`DELETE` with JSON body where
applicable.

**`web/src/lib/buildJobForm.ts` / `buildBatchForm.ts`**: accept optional
`name` argument, append to `FormData` when non-blank.

**`web/src/pages/NewJob.tsx`**: optional "Name" text field above file
uploads for both single and batch modes, passed through to `buildJobForm`/
`buildBatchForm`.

**`web/src/pages/JobsList.tsx`**: each row shows `name ?? id` as primary
label; trailing trash-icon button opens a confirm (native `window.confirm`
is fine here — destructive, infrequent, no custom modal in codebase yet) and
on confirm calls `deleteJob`/`deleteBatch`, then invalidates the `jobs`/
`batches` queries.

**`web/src/pages/JobDetail.tsx` / `BatchDetail.tsx`**: header shows
`name ?? id`; pencil-icon button toggles an inline text input pre-filled
with the current name, Enter/blur submits a rename mutation, invalidates the
`job`/`batch` query on success.

**`web/src/App.tsx`**: header gets a back-arrow button before the logo link.
Uses `useNavigate()` + `nav(-1)`. Visibility: rendered only when
`useLocation().key !== "default"` (react-router's marker for the initial
history entry), so it doesn't appear on a fresh tab/deep link with nothing
to go back to, but does appear after any in-app navigation.

## Out of scope

- No rename/delete for batch-owned individual jobs (they're not shown
  standalone in `JobsList` today; deleting the batch removes them).
- No undo for delete.
- No name uniqueness validation — names are just a display label.

## Testing

- `api/tests`: name write/read round-trip in jobstore, create-with-name,
  rename (success + 404), delete (job + batch, success + 404), batch delete
  removes constituent job dirs.
- `web/src`: update `JobsList.test.tsx` (name display, delete flow),
  `NewJob.test.tsx` (name field wired into form), `JobDetail.test.tsx` /
  `BatchDetail.test.tsx` (name display + rename flow), new `App.test.tsx`
  for back-button visibility.
