// Only real, separately captured model observations may be attached to a sample.
// The API receives a drawing alone. Enquiry text and the OCR reading are compared afterwards.
export function crossCheckField(reading, field, drawingValue, geometry) {
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
  let containsOcrCentre = null;
  if (geometry && located) {
    const line = geometry.lines.find(item => norm(item.text).startsWith(norm(field.label) + ':'));
    if (line) {
      const x = (line.x + line.width / 2) * 1000 / geometry.width;
      const y = (line.y + line.height / 2) * 1000 / geometry.height;
      containsOcrCentre = x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
    }
  }
  const corroborated =
    row?.status === 'read' && observed && value === observed && evidence.includes(value) && located && (!geometry || containsOcrCentre === true);
  const bothMissing = row?.status === 'missing' && !observed && !value;
  return {
    status: corroborated ? 'agrees' : bothMissing ? 'both-missing' : 'review',
    model: reading.model,
    containsOcrCentre,
    value: row?.value ?? null,
    evidence: row?.evidence ?? null,
    box: located ? box : null,
    readAt: reading.readAt,
  };
}
