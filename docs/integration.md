# Receiving an estimating handoff

The review workspace and the estimating inbox are separate browser pages with separate responsibilities. The workspace prepares an evidence-linked document. The inbox acts as the downstream consumer and independently replays the decision before adding an enquiry to its queue. Both pages use the same versioned review engine.

## Try both transfer routes

1. Open the **Matched packet** in the workspace. Download its JSON handoff. Visit **Estimating inbox**, choose the file and select **Import handoff**.
2. Open the received entry's **Review accepted evidence** disclosure. Check its RFQ number, quantity and effective revision against the workspace.
3. Return to the same packet and use **Open in inbox**. This route stages the same JSON in the current tab. The existing receipt keeps its original arrival time.
4. Try the **Incomplete evidence** packet. Its exported clarification draft is held at intake. The **Revision discrepancy** packet can pass after an Engineering referral and the supplied written customer clarification have been recorded.

The form accepts version 1 JSON exports up to 128 KiB. Importing a downloaded file works across devices by transferring the file yourself. A direct workspace transfer and the inbox’s list of accepted entries are local to the browser. This intake operation sends no email and does not contact an external estimating system.

| Input | Expected intake result |
| --- | --- |
| Shipped sample with consistent evidence or the controlled clarification recorded | Replay the review and create a local receipt when the full payload matches. |
| Sample with unresolved findings, changed values or unsupported evidence | Decline intake and explain the reason. |
| Visitor photograph or file and its OCR or OpenAI readings | The [image reader](https://rongsenzhang.github.io/drawing-desk/upload.html) returns provisional observations. They have no controlled enquiry identity or replay record in the sample library, so they cannot enter the verified queue. Model-service integration is documented separately in the [hosted reader contract](openai-service.md). |

## Intake contract

The receiver requires schema `drawing-desk/handoff`, schema version `1`, status `ready` and document type `estimating-handoff`. It looks up the synthetic packet by ID and rebuilds the expected output from the shipped enquiry, OCR transcript, clause catalogue and supplied decision history. An invalid review event or unresolved finding stops intake. It then checks the entire regenerated handoff, including quantity, original and effective values, references, findings, evidence version and audit events. JSON object property order may vary. Array order and field values must match.

The shipped OCR observation is the reproducible reference for intake. A live reading that differs from that transcript requires review; the inbox accepts only exports that match the shipped evidence. A repeated valid packet retains its original receipt. The receiver reads and writes only its own fixed sample keys and revalidates stored records on display. The browser displays imported free text as text.

The JSON carries an evidence fingerprint for change detection. It has no digital signature or proof of reviewer identity. A valid sequence of decisions can be recreated by anyone who has the fictional sample inputs. The local receipt records arrival in one browser. An authorised production handoff would need authenticated identities, controlled documents, access checks on both systems, durable event history and a tested interface to the estimating service.

### Reproduce a failed intake

Download a matched handoff, change its `requestedQuantity` to another positive number and import it. The inbox should report a mismatch, and the queue should remain unchanged. Import the unedited handoff and repeat the import to observe the accepted and duplicate paths. Automated tests also exercise edited fields and references, falsified statuses, malformed decision histories, stale receipts and file limits. [Intake implementation](../app/intake.mjs) · [Intake tests](../tests/intake.test.mjs)
