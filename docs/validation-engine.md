# Evidence and validation

The three enquiries concern fictional stockroom identification plates. All customer text, drawing identifiers, reference clauses and clarifications were written for this demonstration. The rules answer a narrow question: does the supplied packet contain enough consistent information for an estimator to begin a review?

## Expected outcomes

| Packet | Original evidence | Initial result | Reviewer action | Result |
| --- | --- | --- | --- | --- |
| RFQ-104 | The RFQ requests revision A. The scan reads B. | Held, one revision discrepancy | Refer to Engineering, then read and select CL-104-02. Give a reason for applying the customer’s written clarification. | The effective revision becomes B. Both original observations and both review actions remain available. |
| RFQ-208 | Five fields agree and the request specifies 12 units. | Ready for estimating | Export the estimating handoff. | The receiver can compare the recorded sources and effective fields. |
| RFQ-312 | The request cites WS-12. The scan has no specification label. | Held, one missing reference | Refer to Quality and export a clarification draft. | The finding stays referred. An applicable customer correction is still needed. |

## What gets checked

The interpreter reads labelled part ID, revision, material, finish and specification fields independently from the RFQ and OCR text. It compares case and whitespace consistently while retaining the original RFQ, OCR transcript and matched source lines. Missing fields, placeholders, contradictory duplicate values and mismatches block handoff. The RFQ quantity must be a positive whole number that JavaScript can represent exactly. The specification name must resolve to a current plate specification in the local catalogue. A retired record remains searchable and carries its status.

The review history records the action, route, user-entered reason, time and clarification reference. A referral routes responsibility and keeps the packet held. A resolved revision needs an Engineering referral, a current revision-review instruction and a supplied clarification matching the enquiry, part, finding and observed drawing revision. Only the revision scenario includes that document. Revisiting a packet replays events against the current evidence, in sequence. Invalid events are ignored and counted. A change to the RFQ, OCR transcript, catalogue or clarification invalidates the old evidence version.

The engine returns a frozen analysis. The export creates a separate JSON object with the original request, OCR text, reference records, dispositions, history and effective values. Observed agreement and a ready handoff indicate readiness for **estimating review**. Formal pricing, customer acceptance and technical certification require separate decisions.

## Reproduce the checks

From the repository root, use Node.js 22 or later.

```sh
node --test tests/engine.test.mjs
node scripts/evaluate-search.mjs
```

The 14 engine regression groups check initial states, parsing variants, both source texts, duplicate and placeholder observations, quantity limits, reference type and status, routing, clarification applicability, reasons, event order, stale histories, evidence retention, independent exports, retrieval behaviour and input rejection. One group feeds the recorded browser OCR outputs into the same comparison engine. Running this file exercises the interpretation layer. Raster recognition needs a browser and is evaluated separately.

## Search evaluation

Search is lexical BM25 with English stop words, repeated title terms, k1 of 1.2 and b of 0.75. It searches six synthetic clauses. Scores rank this query’s results and have no probability interpretation. Validation requires an exact applicable identifier. A high-scoring search result cannot fill an absent field.

| Development measure | Result |
| --- | --- |
| Expected clause ranked first | 6 of 8 queries with an expected answer |
| Expected clause in the first three | 7 of 8 |
| No result on unrelated or stop-word-only controls | 2 of 2 |

The search script prints every query, expected record and returned identifiers. A query about units ordered uses different vocabulary from the quantity clause and retrieves nothing. For a material/finish query, the general plate clause ranks ahead of the more specific review instruction. The ten developer-authored examples were available during design. They establish repeatable development behaviour, with no claim of independent or shop-floor performance.

## Validation boundaries

The three scans share a designed layout and vocabulary. English labelled fields and one revision-clarification path are supported. Other layouts, handwritten notes, richer technical semantics, conflicting customer responses and multi-party authorisation need broader evaluation. The six fictional records illustrate retrieval and version status. The demo cannot establish compliance with a real specification or regulator.

The review log is local to a browser. The change fingerprint supports stale-history detection; it does not authenticate an identity or digitally sign evidence. An industrial pilot would need permissioned source documents, representative historical cases, independent field-level labels, document- and customer-level test splits, authorised reviewer identities and an agreed rule for safely handling misses. Useful pilot measures include missed blocking discrepancies and findings routed for unnecessary review, alongside reviewer time per enquiry.
