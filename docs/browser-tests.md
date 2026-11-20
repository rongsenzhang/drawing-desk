# Browser acceptance

The acceptance script visits the published web interface and performs the same actions available to a reviewer. Each run starts two independent browser profiles, with a 1440 × 900 desktop viewport and a 390 × 844 touch-enabled phone viewport.

Install the pinned development packages and browser engines from the repository root.

```sh
npm ci
npx playwright install chromium webkit
```

Serve the project with a static HTTP server, or supply the published project address. The local default is http://127.0.0.1:8000/.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

In a second terminal, run both browser engines.

```sh
npm run test:browser
BROWSER_ENGINE=webkit npm run test:browser
```

Set `BASE_URL` to test a different URL, including a GitHub Pages project path. For an existing Chrome installation, set `CHROME_PATH` to its executable when using Chromium. The process exits with an error and identifies the action and viewport if a check fails.

## What the script checks

- Open the operator guide and switch between the original enquiry, scan and OCR transcript.
- Highlight revision evidence on the scan, toggle detected holes and rerun actual OCR.
- Search for a clause by ID and exercise the no-results state.
- Refer a disagreement, inspect the supplied customer response, apply its clarification and recover both actions after a reload.
- Download an actual handoff file and import it into the separate estimating inbox. Verify the effective revision, original observations, decision evidence and duplicate receipt behaviour.
- Transfer a matched packet directly to the inbox. Refer a missing specification to Quality and verify that its exported draft is refused.
- Check for horizontal overflow on the workspace, open guide and inbox, and for unexpected external requests, failed network resources or JavaScript errors.

Pre-release local runs passed in Chromium and WebKit, at both viewport sizes, on 20 November 2026. The phone checks use emulated viewports and touch settings. They do not establish behaviour on physical devices, real customer documents or a production estimating system.
