import { crossCheckField } from './model-crosscheck.mjs';
// Review and retrieval for the fictional workshop quotation corpus.
const fields = [
  { key: 'partId', label: 'Part ID', route: 'Engineering', rule: 'WS-12' },
  { key: 'revision', label: 'Revision', route: 'Engineering', rule: 'DC-03' },
  { key: 'material', label: 'Material', route: 'Engineering', rule: 'EN-04' },
  { key: 'finish', label: 'Finish', route: 'Quality', rule: 'EN-04' },
  { key: 'spec', label: 'Spec', route: 'Quality', rule: 'QR-05' },
];
const quantityField = { key: 'quantity', label: 'Quantity', route: 'Commercial', rule: 'CM-02' };
const labels = [...fields, quantityField];
const fieldPattern = /^\s*(PART[\s_]+ID|REVISION|MATERIAL|FINISH|SPEC|QUANTITY)\b\s*[:=]?\s*(.*?)\s*$/i;
const stopwords = new Set('a an and are as at be before by could did do does for from how i in is it my of on or should that the then this to what where which who why will with would your'.split(' '));
const placeholders = new Set(['N/A', 'NA', 'NONE', 'UNKNOWN', 'TBD', 'TBC', 'UNREADABLE', 'NOT PROVIDED', 'NOT SPECIFIED']);
const normal = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const tokens = (value) => String(value).toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)?.filter(t => !stopwords.has(t)) || [];
const asEvidence = (source, documentId, text) => ({ source, documentId, text });

function validReference(record) {
  return record && ['id', 'title', 'text', 'revision'].every(k => typeof record[k] === 'string' && record[k].trim())
    && ['plate-specification', 'review-instruction'].includes(record.kind)
    && ['current', 'retired'].includes(record.status);
}

function checkCatalogue(clauses) {
  if (!Array.isArray(clauses) || clauses.some(c => !validReference(c))
      || new Set(clauses.map(c => c.id)).size !== clauses.length) {
    throw new TypeError('The reference library contains invalid or duplicate records.');
  }
}

export function searchClauses(query, clauses, limit = 5) {
  checkCatalogue(clauses);
  if (typeof query !== 'string' || !Number.isInteger(limit) || limit < 0) {
    throw new TypeError('Enter a text query and a non-negative whole-number limit.');
  }
  const terms = [...new Set(tokens(query))];
  if (!terms.length || !clauses.length || !limit) return [];
  const docs = clauses.map(c => tokens(`${c.id} ${c.title} ${c.title} ${c.text}`));
  const meanLength = docs.reduce((sum, terms) => sum + terms.length, 0) / docs.length;
  const frequencies = new Map(terms.map(term => [term, docs.filter(d => d.includes(term)).length]));
  return clauses.map((clause, i) => {
    let score = 0;
    for (const term of terms) {
      const count = docs[i].filter(t => t === term).length;
      if (!count) continue;
      const df = frequencies.get(term);
      const inverseFrequency = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += inverseFrequency * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * docs[i].length / meanLength));
    }
    return { ...clause, score: Number(score.toFixed(4)) };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

function parseLabels(text) {
  const result = Object.fromEntries(labels.map(f => [f.key, []]));
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const match = fieldPattern.exec(lines[i]);
    if (!match) continue;
    const field = labels.find(f => normal(f.label) === normal(match[1].replaceAll('_', ' ')));
    let value = match[2].trim();
    let original = lines[i].trim();
    if (!value && lines[i + 1]?.trim() && !fieldPattern.test(lines[i + 1])
        && /^[A-Za-z0-9][A-Za-z0-9 .+/–-]{0,39}$/.test(lines[i + 1].trim())) {
      value = lines[++i].trim();
      original += '\n' + value;
    }
    if (value) result[field.key].push({ value, original });
  }
  return result;
}

function values(observations) {
  return [...new Set(observations.map(row => normal(row.value)))];
}

function unreadable(value) {
  return placeholders.has(value) || !/[A-Z0-9]/.test(value);
}

function lineEvidence(rows, source, id, label) {
  return rows.length ? rows.map(r => asEvidence(source, id, r.original))
    : [asEvidence(source, id, `No readable ${label.toLowerCase()} label in this source.`)];
}

// A change detector for local audit replay. This value provides no authentication.
function fingerprint(payload) {
  const text = JSON.stringify(payload);
  let result = 2166136261;
  for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619);
  return `v1-${text.length}-${(result >>> 0).toString(16).padStart(8, '0')}`;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function referenceEvidence(record) {
  return asEvidence('Reference clause', record.id, `${record.title} · revision ${record.revision} · ${record.status}. ${record.text}`);
}

function makeFinding(id, title, detail, field, evidence, catalogue) {
  const clause = catalogue.find(c => c.id === field.rule && c.status === 'current');
  return { id, title, detail, fieldKey: field.key, severity: 'blocking', route: field.route,
    status: 'open', decision: null, evidence: clause ? [...evidence, referenceEvidence(clause)] : evidence };
}

function checkDecision(analysis, finding, input) {
  if (!finding) throw new Error('The finding does not belong to this packet.');
  if (!input || !['refer', 'resolve'].includes(input.action)) throw new Error('Choose a valid review action.');
  if (input.route !== finding.route) throw new Error(`Route this finding to ${finding.route}.`);
  if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.trim().length > 1000) {
    throw new Error('Enter a reason between 10 and 1,000 characters.');
  }
  if (input.action === 'refer') {
    if (finding.status !== 'open') throw new Error('Only an open finding can be referred.');
    if (input.evidenceRef) throw new Error('A referral does not accept a clarification.');
    return null;
  }
  if (finding.status !== 'referred') throw new Error('Refer this finding to its reviewer before recording a clarification.');
  const document = analysis.availableEvidence.find(c => c.id === input.evidenceRef && c.findingId === finding.id && c.route === finding.route);
  if (!document) throw new Error('A controlled clarification for this specific finding is required.');
  return document;
}

export function recordDecision(analysis, findingId, input) {
  const finding = analysis.findings.find(f => f.id === findingId);
  checkDecision(analysis, finding, input);
  return [...analysis.decisions, {
    packetId: analysis.packetId, evidenceVersion: analysis.evidenceVersion, findingId,
    action: input.action, route: input.route, reason: input.reason.trim(),
    evidenceRef: input.action === 'resolve' ? input.evidenceRef : '', at: new Date().toISOString(),
  }];
}

function applyHistory(analysis, history) {
  for (const event of history) {
    const issue = analysis.findings.find(f => f.id === event?.findingId);
    try {
      if (event?.packetId !== analysis.packetId || event.evidenceVersion !== analysis.evidenceVersion) throw new Error();
      if (typeof event.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at)
          || new Date(event.at).toISOString() !== event.at) throw new Error();
      if (analysis.decisions.length && event.at < analysis.decisions.at(-1).at) throw new Error();
      const document = checkDecision(analysis, issue, event);
      const saved = {
        packetId: event.packetId, evidenceVersion: event.evidenceVersion, findingId: issue.id,
        action: event.action, route: event.route, reason: event.reason.trim(),
        evidenceRef: document?.id || '', at: event.at,
      };
      analysis.decisions.push(saved);
      issue.decision = saved;
      issue.status = document ? 'resolved' : 'referred';
      if (document) {
        issue.evidence.push(asEvidence('Customer clarification', document.id, document.text));
        const field = analysis.fields.find(f => f.key === issue.fieldKey);
        field.status = 'resolved';
        field.effective = document.value;
        field.effectiveSource = document.id;
      }
    } catch {
      analysis.ignoredDecisions++;
    }
  }
}

function availableClarifications(fixture, findingList, parsedFields) {
  const part = parsedFields.find(f => f.key === 'partId');
  const documents = fixture.clarifications || [];
  const ids = documents.map(c => c?.id);
  return documents.filter(c => c && ids.filter(id => id === c.id).length === 1 &&
    ['id', 'title', 'text', 'value', 'route', 'findingId'].every(k => typeof c[k] === 'string' && c[k].trim()) &&
    c.rfqId === fixture.rfqId && part.status === 'matched' && normal(c.partId) === part.effective &&
    findingList.some(issue => issue.id === c.findingId && issue.route === c.route && issue.fieldKey === 'revision') &&
    parsedFields.some(f => f.key === 'revision' && f.status === 'conflict' && normal(c.value) === f.drawing && !f.drawing.includes(' | '))
  ).map(c => ({ id: c.id, title: c.title, text: c.text, route: c.route, findingId: c.findingId, value: normal(c.value) }));
}

export function analyzePacket(fixture, drawingText, catalogue, decisions = []) {
  if (!fixture || ['id', 'rfqId', 'partName', 'title', 'scan', 'rfqText'].some(k => typeof fixture[k] !== 'string')
      || ['id', 'rfqId', 'partName', 'title', 'scan'].some(k => !fixture[k].trim())
      || typeof drawingText !== 'string' || !Array.isArray(decisions)
      || (fixture.clarifications !== undefined && !Array.isArray(fixture.clarifications))) {
    throw new TypeError('Invalid packet, OCR text or review history.');
  }
  checkCatalogue(catalogue);
  const request = parseLabels(fixture.rfqText);
  const drawing = parseLabels(drawingText);
  const findings = [];
  const fieldRows = fields.map(field => {
    const a = values(request[field.key]);
    const b = values(drawing[field.key]);
    const missing = !a.length || !b.length || a.some(unreadable) || b.some(unreadable);
    const status = missing ? 'missing' : a.length === 1 && b.length === 1 && a[0] === b[0] ? 'matched' : 'conflict';
    const evidence = [...lineEvidence(request[field.key], 'RFQ', fixture.rfqId, field.label),
      ...lineEvidence(drawing[field.key], 'Drawing OCR', fixture.scan, field.label)];
    if (status !== 'matched') {
      const title = status === 'missing' ? `Missing ${field.label.toLowerCase()} evidence` : `${field.label} discrepancy`;
      const detail = status === 'missing' ? 'The required field could not be read from both sources.'
        : 'The observed values conflict. Obtain a written clarification.';
      findings.push(makeFinding(`field-${field.key}`, title, detail, field, evidence, catalogue));
    }
    return { key: field.key, label: field.label, request: a.join(' | '), drawing: b.join(' | '),
      status, effective: status === 'matched' ? a[0] : '', effectiveSource: status === 'matched' ? 'RFQ and drawing' : '', evidence };
  });
  if (fixture.modelReading) {
    for (const item of fieldRows) {
      const field = fields.find(f => f.key === item.key);
      item.modelCheck = crossCheckField(fixture.modelReading, field, item.drawing);
      const check = item.modelCheck;
      const witness = asEvidence('OpenAI vision', check.model, check.evidence || 'No readable evidence supplied for this field.');
      item.evidence.push(witness);
      if (check.status === 'review') {
        findings.push(makeFinding('vision-' + field.key, field.label + ' requires a visual check',
          'The model and OCR could not corroborate a located source reading.', field, [...item.evidence], catalogue));
        item.effective = '';
        item.effectiveSource = '';
      }
    }
  }
  const quantities = values(request.quantity);
  const count = quantities.length === 1 && /^[1-9]\d*$/.test(quantities[0]) ? Number(quantities[0]) : null;
  const requestedQuantity = Number.isSafeInteger(count) ? count : null;
  if (requestedQuantity === null) {
    findings.push(makeFinding('request-quantity', 'Quantity needs clarification', 'The request needs one positive whole-number quantity.',
      quantityField, lineEvidence(request.quantity, 'RFQ', fixture.rfqId, 'Quantity'), catalogue));
  }
  const spec = fieldRows.find(f => f.key === 'spec');
  const specRecord = catalogue.find(c => normal(c.id) === spec.effective);
  if (spec.status === 'matched' && (!specRecord || specRecord.status !== 'current' || specRecord.kind !== 'plate-specification')) {
    const evidence = [...spec.evidence, ...(specRecord ? [referenceEvidence(specRecord)] : [])];
    findings.push(makeFinding('spec-reference', 'Specification needs review',
      'The identifier must match a current plate specification in the local reference library.',
      fields.find(f => f.key === 'spec'), evidence, catalogue));
    spec.effective = ''; spec.effectiveSource = '';
  }
  const clauseRefs = new Set(['WS-12', ...findings.map(f => labels.find(field => field.key === f.fieldKey)?.rule)]);
  if (specRecord) clauseRefs.add(specRecord.id);
  const clauses = catalogue.filter(c => clauseRefs.has(c.id)).map(c => ({ ...c }));
  const evidence = [asEvidence('RFQ', fixture.rfqId, fixture.rfqText), asEvidence('Drawing OCR', fixture.scan, drawingText), ...clauses.map(referenceEvidence)];
  const analysis = {
    packetId: fixture.id, rfqId: fixture.rfqId, partName: fixture.partName, fixtureTitle: fixture.title,
    evidenceVersion: fingerprint([fixture.id, fixture.rfqId, fixture.scan, fixture.rfqText, drawingText, catalogue, fixture.clarifications || [], fixture.modelReading || null]),
    requestedQuantity, fields: fieldRows, findings, evidence, clauses, decisions: [], ignoredDecisions: 0,
    availableEvidence: catalogue.some(c => c.id === 'DC-03' && c.status === 'current')
      ? availableClarifications(fixture, findings, fieldRows) : [],
  };
  applyHistory(analysis, decisions);
  for (const issue of findings) {
    issue.allowedActions = issue.status === 'open' ? ['refer'] : issue.status === 'referred' && analysis.availableEvidence.some(c => c.findingId === issue.id) ? ['resolve'] : [];
  }
  for (const doc of analysis.availableEvidence) analysis.evidence.push(asEvidence('Customer clarification', doc.id, doc.text));
  const unresolved = findings.filter(f => f.status !== 'resolved').length;
  analysis.counts = { fields: fieldRows.length, matched: fieldRows.filter(f => f.status === 'matched').length,
    findings: findings.length, open: findings.filter(f => f.status === 'open').length, referred: findings.filter(f => f.status === 'referred').length,
    resolved: findings.filter(f => f.status === 'resolved').length, unresolved };
  analysis.handoffAllowed = !unresolved;
  analysis.status = unresolved ? 'held' : 'ready';
  analysis.summary = unresolved ? `${unresolved} blocking finding${unresolved === 1 ? '' : 's'} must be clarified before estimating.` : 'The packet is ready for estimating review.';
  return freeze(analysis);
}

export function buildHandoff(analysis) {
  if (!analysis || !Object.isFrozen(analysis) || !['ready', 'held'].includes(analysis.status)) {
    throw new TypeError('Analyse the packet before exporting.');
  }
  return structuredClone({
    schema: 'drawing-desk/handoff', schemaVersion: 1,
    packetId: analysis.packetId, rfqId: analysis.rfqId, partName: analysis.partName,
    status: analysis.status, documentType: analysis.handoffAllowed ? 'estimating-handoff' : 'clarification-draft',
    summary: analysis.summary, requestedQuantity: analysis.requestedQuantity, evidenceVersion: analysis.evidenceVersion,
    fields: analysis.fields, findings: analysis.findings, decisions: analysis.decisions, evidence: analysis.evidence, clauses: analysis.clauses,
  });
}
