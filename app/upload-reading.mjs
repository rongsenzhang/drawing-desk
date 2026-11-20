export const maxInputBytes = 12 * 1024 * 1024;
export const maxOutputBytes = 1024 * 1024;
export const keys = [
  ['partId', 'Part ID'], ['revision', 'Revision'], ['material', 'Material'],
  ['finish', 'Finish'], ['spec', 'Specification'],
];
const labels = {
  partId: 'PART\\s+(?:ID|NUMBER|NO\\.?)|P/N',
  revision: 'REVISION|REV\\.?',
  material: 'MATERIAL',
  finish: 'FINISH',
  spec: 'SPECIFICATION|SPEC',
};
const labelPattern = Object.values(labels).join('|');
const tidy = value => value.trim().replace(/\s+/g, ' ').toUpperCase();
const labelKeys = Object.entries(labels).map(([key, expr]) => [key, new RegExp('^(?:' + expr + ')$', 'i')]);

/** Read dimensions from the file before allocating a decoded pixel buffer. */
export function imageHeader(buffer) {
  const b = new Uint8Array(buffer), d = new DataView(buffer);
  const word = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  let width, height, type;
  if (b.length >= 24 && b[0] === 137 && word(1, 3) === 'PNG' && word(12, 4) === 'IHDR') {
    type = 'image/png'; width = d.getUint32(16); height = d.getUint32(20);
  } else if (b.length > 12 && b[0] === 255 && b[1] === 216) {
    type = 'image/jpeg';
    let at = 2;
    while (at + 4 <= b.length && b[at] === 255) {
      while (b[at] === 255) at++;
      const tag = b[at++];
      if (tag === 0xda || tag === 0xd9 || at + 2 > b.length) break;
      if (tag === 0x01 || tag >= 0xd0 && tag <= 0xd8) continue;
      const size = d.getUint16(at);
      if (size < 2 || at + size > b.length) break;
      if (tag >= 0xc0 && tag <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(tag) && size >= 7) {
        height = d.getUint16(at + 3); width = d.getUint16(at + 5); break;
      }
      at += size;
    }
  } else if (b.length >= 25 && word(0, 4) === 'RIFF' && word(8, 4) === 'WEBP') {
    type = 'image/webp';
    const chunk = word(12, 4);
    if (chunk === 'VP8X' && b.length >= 30) {
      width = 1 + b[24] + 256 * b[25] + 65536 * b[26]; height = 1 + b[27] + 256 * b[28] + 65536 * b[29];
    } else if (chunk === 'VP8L' && b[20] === 0x2f) {
      width = 1 + b[21] + ((b[22] & 0x3f) << 8); height = 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 0x0f) << 10);
    } else if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 1 && b[25] === 42) {
      width = d.getUint16(26, true) & 0x3fff; height = d.getUint16(28, true) & 0x3fff;
    }
  }
  if (!width || !height) throw new Error('Choose a readable JPEG, PNG or WebP image. Export a PDF or HEIC page as JPEG or PNG first.');
  if (width > 20000 || height > 20000 || width * height > 50000000) throw new Error('This image is too large to decode. Export it below 50 megapixels and 20,000 pixels per side.');
  return { width, height, type };
}

export function localFields(text) {
  const lines = text.split(/\r\n?|\n/);
  const observations = new Map(keys.map(([key]) => [key, []]));
  const pattern = new RegExp('(?:^|[\\s|])(' + labelPattern + ')(?=[:=\\s]|$)', 'gi');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], matches = [...line.matchAll(pattern)];
    for (const [j, match] of matches.entries()) {
      const key = labelKeys.find(([, re]) => re.test(match[1]))[0];
      let value = line.slice(match.index + match[0].length, matches[j + 1]?.index).split('|')[0].replace(/^[\s:=]+/, '').trim();
      let evidence = line.trim();
      if (!value && matches.length === 1 && !lines[i + 1]?.match(pattern) && /^[\w][\w .+\-/]{0,40}$/.test(lines[i + 1]?.trim() || '')) {
        value = lines[i + 1].trim(); evidence += '\n' + value;
      }
      if (value.length > 0 && value.length <= 100 && !/^(?:[-?.]+|N\/A|UNKNOWN|TBC|TBD)$/i.test(value)) {
        observations.get(key).push({ value, evidence });
      }
    }
  }
  return keys.map(([key]) => {
    const occurrences = observations.get(key);
    const distinct = new Set(occurrences.map(c => tidy(c.value)));
    if (distinct.size === 1) return { key, status: 'read', ...occurrences[0] };
    if (distinct.size > 1) return { key, status: 'uncertain', value: null, evidence: occurrences.map(c => c.evidence).join(' / ') };
    return { key, status: 'missing', value: null, evidence: null };
  });
}

export function modelReading(result) {
  if (!result || typeof result.model !== 'string' || !result.model.trim() || typeof result.readAt !== 'string'
      || !Number.isFinite(Date.parse(result.readAt)) || !Array.isArray(result.fields)) throw new Error('The image service returned an unreadable response. Try again.');
  const fields = keys.map(([key]) => {
    const rows = result.fields.filter(f => f?.key === key);
    if (!rows.length) return { key, value: null, evidence: null, status: 'missing' };
    const f = rows[0];
    if (rows.length !== 1 || !['read', 'uncertain', 'missing'].includes(f.status)
        || !(f.value === null || typeof f.value === 'string') || !(f.evidence === null || typeof f.evidence === 'string')) {
      throw new Error('The image service returned invalid field evidence. Try again.');
    }
    const value = f.value?.trim() || null, evidence = f.evidence?.trim() || null;
    return { key, value: f.status === 'missing' ? null : value, evidence, status: f.status === 'read' && (!value || !evidence) ? 'uncertain' : f.status };
  });
  return { model: result.model, readAt: result.readAt, fields };
}

export function compareField(local, remote) {
  if (!local || !remote) return ['pending', 'Awaiting the other reading'];
  if (local.status === 'read' && remote.status === 'read') return tidy(local.value) === tidy(remote.value)
    ? ['match', 'Values agree'] : ['disagreement', 'Values differ'];
  if (local.status === 'read' && remote.status === 'missing' || local.status === 'missing' && remote.status === 'read') {
    return ['disagreement', 'Only one reader found a value'];
  }
  return ['review', 'Missing or uncertain evidence'];
}
