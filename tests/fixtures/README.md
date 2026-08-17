# Integration fixtures

Drop a small real RINEX set here to enable `test_solve_integration_real_binary`:

- `rover.obs` — rover observation RINEX
- `base.obs` — base observation RINEX
- `brdc.nav` — broadcast navigation RINEX

The test is marked `requires_rtklib` and skips when `rnx2rtkp` is not on PATH
or when these files are absent.
