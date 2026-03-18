# H000034 Cyberball Task

HTML/browser preview of Cyberball Task built with `psyflow-web`.
Three-player toss flow, inclusion/exclusion block policy, shared ball-holder state, and block/session summary counters are aligned to local `T000034-cyberball`.

## Layout

- `main.ts`: task orchestration
- `config/config.yaml`: declarative config
- `src/controller.ts`: toss policy and counters
- `src/run_trial.ts`: toss-event trial logic
- `src/utils.ts`: block/overall summary helpers

## Run

From `e:\xhmhc\TaskBeacon\psyflow-web`:

```powershell
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4173/?task=H000034-cyberball
```

