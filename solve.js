// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Same answers as csv-reader's readCsv on every input, faster.
//
// Strategy: the reference walks one character at a time and concatenates
// one character at a time. This version never does either on the hot path:
//   - unquoted fields: two native indexOf scans (',' and '\n') find the next
//     delimiter, the field is one slice; a '\r' inside the slice (stray CR)
//     is the only case that falls back to a char loop, and CRLF line ends
//     are recognised by the char before the '\n'.
//   - quoted fields: one native indexOf('"') finds the closing quote (or a
//     doubled quote, handled by accumulating slices); segments containing
//     a line break are the only ones that pay for a CR->LF transform and a
//     line recount, via native replace/match.
//   - everything else (BOM, empty lines, stray-CR-only lines, short/long
//     rows, error records and their order) follows the reference exactly.
//
// No dependencies, no network, no clock, no randomness, no state kept
// between calls: run(input) is pure, so two runs are byte-identical.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  // One full scan up front: when the input has no CR anywhere, every
  // per-field `indexOf('\r')` below is a wasted scan of a field that
  // cannot contain one, so it is skipped. With a CR present the code
  // takes exactly the old path, so answers are unchanged either way.
  const hasCR = text.indexOf('\r') !== -1;
  let pos = 0; // next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field starting at pos, with `head` already accumulated
  // ('' normally, '"' for an unterminated quote, the quoted value for junk
  // after a closing quote). Returns [value, ended, added] where added counts
  // the characters kept during this call (used only for the quote_junk test).
  function readUnquoted(head) {
    const c = text.indexOf(',', pos);
    const n = text.indexOf('\n', pos);
    let m;
    let kind; // 0 comma, 1 LF, 2 end of text
    if (c !== -1 && (n === -1 || c < n)) { m = c; kind = 0; }
    else if (n !== -1) { m = n; kind = 1; }
    else { m = len; kind = 2; }
    if (kind === 2) {
      const seg = text.slice(pos, len);
      if (!hasCR || seg.indexOf('\r') === -1) {
        pos = len;
        return [head + seg, END, seg.length];
      }
      return readUnquotedSlow(head);
    }
    if (kind === 0) {
      const seg = text.slice(pos, m);
      if (!hasCR || seg.indexOf('\r') === -1) {
        pos = m + 1;
        return [head + seg, COMMA, seg.length];
      }
      return readUnquotedSlow(head);
    }
    // Line break at m: CRLF when the char before the LF is a CR.
    if (m > pos && text.charCodeAt(m - 1) === 13) {
      const seg = text.slice(pos, m - 1);
      if (!hasCR || seg.indexOf('\r') === -1) {
        pos = m + 1;
        line += 1;
        return [head + seg, LINE_BREAK, seg.length];
      }
      return readUnquotedSlow(head);
    }
    const seg = text.slice(pos, m);
    if (!hasCR || seg.indexOf('\r') === -1) {
      pos = m + 1;
      line += 1;
      return [head + seg, LINE_BREAK, seg.length];
    }
    return readUnquotedSlow(head);
  }

  // Unquoted field that contains a stray CR (rare): char loop, slice
  // accumulation, each lone CR dropped with a stray_cr error.
  function readUnquotedSlow(head) {
    let added = 0;
    let start = pos;
    for (;;) {
      if (pos >= len) {
        if (pos > start) { head += text.slice(start, pos); added += pos - start; }
        return [head, END, added];
      }
      const cc = text.charCodeAt(pos);
      if (cc === 44) { // ','
        if (pos > start) { head += text.slice(start, pos); added += pos - start; }
        pos += 1;
        return [head, COMMA, added];
      }
      if (cc === 10) { // LF
        if (pos > start) { head += text.slice(start, pos); added += pos - start; }
        pos += 1;
        line += 1;
        return [head, LINE_BREAK, added];
      }
      if (cc === 13) { // CR
        if (text.charCodeAt(pos + 1) === 10) {
          if (pos > start) { head += text.slice(start, pos); added += pos - start; }
          pos += 2;
          line += 1;
          return [head, LINE_BREAK, added];
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (pos > start) { head += text.slice(start, pos); added += pos - start; }
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let head = ''; // accumulated pieces once a doubled quote was seen
    let cur = pos + 1; // scan start: just past the opening quote
    let value;
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote, keep scanning.
        const seg = text.slice(cur, q);
        if (seg.indexOf('\n') !== -1 || (hasCR && seg.indexOf('\r') !== -1)) {
          const breaks = seg.match(/\r\n|\r|\n/g);
          if (breaks) line += breaks.length;
          head += seg.replace(/\r\n?/g, '\n');
        } else {
          head += seg;
        }
        head += '"';
        cur = q + 2;
        continue;
      }
      // Closing quote at q.
      const seg = text.slice(cur, q);
      if (seg.indexOf('\n') === -1 && (!hasCR || seg.indexOf('\r') === -1)) {
        value = head + seg;
      } else {
        const breaks = seg.match(/\r\n|\r|\n/g);
        if (breaks) line += breaks.length;
        value = head + seg.replace(/\r\n?/g, '\n');
      }
      pos = q + 1;
      break;
    }
    if (pos >= len) return [value, END, 0];
    const cc = text.charCodeAt(pos);
    if (cc === 44) { // ','
      pos += 1;
      return [value, COMMA, 0];
    }
    if (cc === 10) { // LF
      pos += 1;
      line += 1;
      return [value, LINE_BREAK, 0];
    }
    if (cc === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
      pos += 2;
      line += 1;
      return [value, LINE_BREAK, 0];
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field[0]);
    } while (field[1] === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
