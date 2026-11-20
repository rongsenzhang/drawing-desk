// Only real, separately captured model observations may be attached to a sample.
// The API receives a drawing alone. Enquiry text and the OCR reading are compared afterwards.
export function crossCheckField(reading, field, drawingValue) {
  const rows = Array.isArray(reading?.fields) ? reading.fields.filter((row) => row?.key === field.key) : [];
  const norm = (value) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
  const row = rows.length === 1 ? rows[0] : null;
  const observed = norm(drawingValue);
  const value = norm(row?.value);
  const evidence = norm(row?.evidence);
  const box = row?.box;
  const located =
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000) &&
    box[2] > box[0] &&
    box[3] > box[1];
  const corroborated =
    row?.status === 'read' && observed && value === observed && evidence.includes(value) && located;
  const bothMissing = row?.status === 'missing' && !observed && !value;
  return {
    status: corroborated ? 'agrees' : bothMissing ? 'both-missing' : 'review',
    model: reading.model,
    value: row?.value ?? null,
    evidence: row?.evidence ?? null,
    box: located ? box : null,
    readAt: reading.readAt,
  };
}
