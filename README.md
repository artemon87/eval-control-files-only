# Eval Control Center

Responsive React/TypeScript dashboard for read-only monitoring of unit and end-to-end evaluation results.

## Evaluation boundaries

- **Unit**: one run evaluates exactly one skill. The run carries `skill`, `environment`, `unit_config.skill_version`, and `unit_config.bsa_version`. The Compare view groups by skill and defaults to the latest run versus the previous run, including when both runs use the same skill version.
- **E2E**: one run executes live conversations against one deployed target in one stage. `e2e_config.selected_suites` may be the target's full suite list or a subset.
- Runs and cases are separate. The dashboard fetches the small execution envelope first, then fetches case evidence only for an opened run.

## Backend connection

Copy the environment example and point it to the FastAPI service:

```bash
cp .env.example .env.local
npm ci
npm run dev
```

```text
NEXT_PUBLIC_EVAL_API_URL=http://localhost:8080/api/v1
```

The application calls these read-only routes:

```text
GET /api/v1/unit/runs
GET /api/v1/unit/runs/{run_id}/cases
GET /api/v1/e2e/runs
GET /api/v1/e2e/runs/{run_id}/cases
```

When the variable is absent, the app intentionally uses deterministic demo data. When the top-level run feed is unavailable, it displays the connection error and falls back to that demo set. Case and comparison failures never mix demo cases into live MongoDB runs.

Overview metrics, attention items and trend lines are calculated from live run summaries. Use the evaluation-type and 7/30/90-day controls to change the dashboard scope.

The Evaluation Runs screen normalizes API verdict spellings before filtering. `error` execution states are presented as **Blocked**, and `xpass`/`xpassed` are presented as **XPASS**. XPASS means a case marked as a known or expected failure unexpectedly passed; it is successful evidence, but should prompt review of the stale expected-failure marker. Advanced run filters cover execution status, stage/environment, trigger, actor and relative start time.

## Development and validation

```bash
npm ci
npm run lint
npm run dev
npm run build
```

UTC date strings are rendered deterministically to avoid server/client hydration mismatches.

## Container and Kubernetes

The public API URL is compiled into the browser bundle. Supply it while building:

```bash
docker build \
  --build-arg NEXT_PUBLIC_EVAL_API_URL=https://eval-api.example.com/api/v1 \
  -t eval-control-center:latest .
```

`deploy/kubernetes.yaml` provides a rolling two-replica Deployment, Service, health probes, resource bounds, PodDisruptionBudget and CPU HPA. Replace the example image and API URL for your environment.
