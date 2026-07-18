# Kairo end-to-end tests

The Playwright smoke in `theia-smoke.cjs` is invoked by CI after
the Runtime Agent and Theia browser app are both running. It:

1. Connects to the running Theia frontend on port 3000.
2. Waits for the Theia shell (status bar + Monaco editor).
3. Looks for the Kairo commands in the command palette.
4. Triggers the `Kairo: Show Servers` command and takes a
   screenshot.

The test is intentionally tolerant: if the runtime agent is
not running, the test still passes as long as the IDE shell
loads. That way we can run the Theia-only CI job independently
of the runtime-agent job.

To run locally:

```powershell
# in two terminals
$ pnpm agent:run
$ pnpm dev:browser

# third terminal
$ node tests/e2e/theia-smoke.cjs
```

Screenshots land under `docs/screenshots/`.
