# Hosted drawing reader

The optional image reader sends one image from the upload page through a Worker to the OpenAI Responses API. The request contains the image and a fixed extraction instruction. The browser’s OCR transcript, reference answers, customer enquiry and review decisions stay outside that request. The reader returns five observations for a person to check against the drawing. Local OCR remains available independently. [Worker source](../service/worker.mjs) · [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision)

## Reading contract

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Returns the model name and Boolean flags for a configured server credential, accessible quota table and their combined readiness. This inexpensive check does not exercise the credential or run inference. |
| `POST /api/read` | Accepts JSON with one `image` property containing a JPEG or PNG base64 data URL. The Worker bounds the streamed request at 5 MiB including base64 overhead and checks the format signature and dimensions. The image must fit within 6,000 pixels per side and 12 megapixels. |

The Worker requests `gpt-6.2-astra` with high reasoning effort, high image detail, a strict JSON schema and a 4,000-token output ceiling. It sends no tools or follow-up conversation and uses `store: false`. A successful response includes the requested model alias, UTC reading time and exactly one field for each of `partId`, `revision`, `material`, `finish` and `spec`. [Model card](https://developers.openai.com/api/docs/models/gpt-6.2-astra) · [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Every field has a status, value, quoted evidence and optional location. A `read` value requires a supporting quote containing that value and a bounded evidence rectangle. Rectangle coordinates are approximate integers in the range 0–1000, ordered left, top, right, bottom, relative to the full submitted raster. A missing location or a quote that fails to support the value downgrades the reading to `uncertain`. Missing and uncertain fields carry a null value. The service rejects incomplete and malformed model responses. Structural checks cannot establish whether the model actually read the pixels correctly.

## Operating the service

1. Use [the build entry point](../service/build.mjs) to package the [Worker](../service/worker.mjs), hosting declaration and [SQLite migration](../service/schema.sql). Run `node service/build.mjs` from the repository root. The build creates a Worker entry at `service/dist/server/index.js` and a Drizzle migration with journal under `service/drizzle/`.
2. On the Worker host, bind its D1 database as `DB` and apply the supplied migration. For the Sites deployment, package the generated migration directory alongside the built Worker. The migration creates one reservation table and two indexes. Repeated application of the statements is safe.
3. Configure `OPENAI_API_KEY` using the host’s server-secret facility. The hosting declaration and static GitHub Pages files contain no credential. Optionally use a separate server-side `RATE_LIMIT_SALT` for hashing client buckets.
4. Set `ALLOWED_ORIGIN` to the exact website origin if a custom deployment is used. The repository default is `https://rongsenzhang.github.io`. The Worker also accepts its own origin. Configure the browser’s public service address in [service configuration](../app/service-config.mjs). CORS affects browser access; quotas also apply to non-browser clients.
5. Check `/api/health` for readiness. A permitted test image sent via the upload page exercises the complete path and consumes one reservation and a billable provider request when successful.

### Quotas, failure handling and data

By default the service reserves up to **100 model attempts per UTC day** in total and **5 per client per fixed ten-minute window**. Server-side overrides accept integers from 0–500 for `GLOBAL_DAILY_LIMIT` and 0–20 for `CLIENT_WINDOW_LIMIT`. Zero disables attempts at that scope. In a single SQLite transaction the receiver prunes older days, conditionally inserts the reservation against both limits and reads the daily count. If the database is unavailable, the worker returns 503 before contacting OpenAI. Concurrent callers compete for the same remaining reservations. A failed upstream call consumes its reservation to bound repeated retries. [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/)

The client bucket uses the edge-provided address hashed with a server secret and a window identifier. Requests without that header share one bucket. The application stores the day, time window and hash only. It writes no image, OCR text, response body or application request log. The provider receives the submitted image; its own retention and abuse-monitoring policies apply. [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

| HTTP status | Operator or reviewer action |
| --- | --- |
| 400, 413, 415 | Check the image type, dimensions, encoded request size and JSON shape. |
| 403, 404, 405 | Check the allowed origin, service address, endpoint path and HTTP method. |
| 429 | The local reservation limit was reached. Use the returned `Retry-After` interval or continue with local OCR. |
| 502 | The provider or returned reading could not be validated. Inspect the document and retry with a clearer crop if appropriate. |
| 503 | The response identifies an unavailable credential, quota service or upstream capacity. An operator can verify the relevant binding or provider account. |
| 504 | The upstream read timed out. The service limits each attempt to 100 seconds. |

## Reproduce the offline checks

Run `node --test tests/service.test.mjs` using the repository’s supported Node runtime. The tests exercise the real route and SQLite statements against a fresh in-memory database. An injected HTTP responder reproduces success, malformed readings, refusal, provider errors and timeout. Parallel tests include four clients competing for the last daily reservation. These tests use synthetic documents and perform zero billable API calls. [Service tests](../tests/service.test.mjs)
