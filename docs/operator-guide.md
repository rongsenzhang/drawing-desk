# Operator exercise

Open the [workspace](https://rongsenzhang.github.io/drawing-desk/) on a phone or computer. Each case contains an original enquiry and a drawing of a workshop stockroom identification plate. An estimator can use the resulting record to see what a customer requested, where it came from and what needs clarification.

## Read a drawing from a phone or computer

1. Open the [image reader](https://rongsenzhang.github.io/drawing-desk/upload.html). Choose **Try a sample drawing**, select a JPEG, PNG or WebP up to 12 MiB, or use **Open live camera** and **Use this frame**. On a compatible phone, **Take a photo** opens the device camera. For a PDF, first export one page as an image.
2. For a multipage static PDF, select the page you want to check. Changing pages clears the earlier reading. Inspect the prepared preview and rotate it if needed. Selecting or photographing a document prepares a new JPEG on this device. Choose **Run browser OCR** to read the page locally. Open the full-image transcript to see exactly what the local reader extracted.
3. For a drawing you can share with the provider, choose **Send to OpenAI**. This action sends the prepared JPEG via the hosted reader to GPT-6.2 Astra. The page also runs a local reading if needed. The hosted service holds the key. Default limits are 100 attempts across the service per UTC day and 5 per client per ten-minute window. A limit or provider failure leaves the local OCR route available.
4. Compare the five fields with the image, the OCR source line and the model’s quoted evidence. Check a revision character or part-number digit closely. Agreement can still reflect two readers making the same mistake. A missing or uncertain field needs inspection of better source material.
5. Choose **Clear image and results** before starting another example. Images supplied on this page produce provisional readings. The estimating inbox accepts the controlled sample workflow described below. [Data handling and quotas](openai-service.md) · [Inbox contract](integration.md)

## An enquiry with conflicting revisions

1. Open **Revision discrepancy** (RFQ-104). In **Enquiry** find revision A. In **Drawing** find B in the title block. Select **Revision** in the requirements table to locate the OCR line on the drawing and see both source readings. **Open full-size scan** opens the original pixels for closer inspection.
2. Click **Rerun recognition**. The first run downloads the bundled English OCR model and engine. Open **OCR transcript** to see the raw result; switch the hole markers on or off to inspect what the geometry detector found.
3. In **References**, search for `revision`. Read the document-control clause and its current or retired status. Return to **Requirements**, expand **View supporting evidence** and compare the two readings.
4. In the review note, explain the discrepancy, for example “Enquiry A conflicts with drawing B. Please confirm the revision to estimate.” Select **Refer to Engineering**. The finding is now referred and the packet remains held.
5. Read the hypothetical customer's written response **CL-104-02**. Select it in the dropdown, record why it supports B, then press **Record clarification**. The comparison keeps both original readings and shows a separate effective revision B. The log records the two decisions and their timestamps.
6. Click **Open in inbox** to transfer the estimating handoff to the separate sample consumer in the same tab. Alternatively download the JSON, open **Estimating inbox**, and import the file. A duplicate should create no extra receipt. The consumer checks the evidence before accepting the packet.

## Two controls

- **Matched packet (RFQ-208)** has consistent sources, a current specification and a quantity. It can proceed to estimating immediately.
- **Incomplete evidence (RFQ-312)** has a blank specification on the drawing. Refer the issue to Quality. The packet has no controlled response to settle the issue, so the inbox should decline its draft. A model's confident reading of the other fields cannot fill that gap.

Decisions persist for this browser and origin. To repeat an exercise, open **Review log**, expand **Restart this practice packet**, and clear its log. Two people or devices do not share a review session. All sample correspondence and specifications are fictional. The estimating inbox records internal readiness for the exercise; commercial pricing, regulatory assessments and order acceptance remain with authorised staff in a real organisation.

## Handover check

A colleague completing this exercise should be able to point to both revisions, name the authority for the effective value, explain why RFQ-312 stays held and describe which action shares an image with OpenAI. For an industrial pilot, record time to decision, missed requirements, unnecessary holds, correction effort and staff feedback on unseen requests. Staff training, timed trials and customer-data evaluation remain future activities.
