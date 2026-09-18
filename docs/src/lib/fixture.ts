/**
 * Strips a leading license/comment header from source text pulled in via a
 * `?raw` import, so docs pages can render source snippets that start at the
 * first real statement instead of the file's boilerplate header.
 */
export function stripHeader(code: string): string {
  const lines = code.split('\n');
  let index = 0;

  // Skip leading blank lines.
  while (index < lines.length && lines[index].trim() === '') {
    index++;
  }

  if (index < lines.length && lines[index].trimStart().startsWith('/*')) {
    // Leading block comment: skip through its closing `*/`.
    while (index < lines.length && !lines[index].includes('*/')) {
      index++;
    }
    // Consume the line containing the closing `*/` itself.
    if (index < lines.length) {
      index++;
    }
  } else {
    // A run of leading `//` comment lines (blank lines in between still
    // count as part of the run, but stop skipping once real content shows
    // up that isn't blank or a `//` comment).
    let sawLineComment = false;
    let cursor = index;
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      if (trimmed.startsWith('//')) {
        sawLineComment = true;
        cursor++;
        continue;
      }
      if (trimmed === '' && sawLineComment) {
        cursor++;
        continue;
      }
      break;
    }
    if (sawLineComment) {
      index = cursor;
    }
  }

  // Skip any blank lines immediately after the stripped header.
  while (index < lines.length && lines[index].trim() === '') {
    index++;
  }

  return lines.slice(index).join('\n');
}
