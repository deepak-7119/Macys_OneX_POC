import type { SyntheticDocImage } from './legacy-contract.ts';

function escape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function wrap(value: string, width: number) {
  // Conservative character units also split long filenames/unbroken words.
  const units = (text: string) =>
    Array.from(text).reduce(
      (sum, character) =>
        sum +
        (/[MWmw@%]/.test(character)
          ? 1.9
          : /[^\u0000-\u007f]/.test(character)
            ? 2
            : /[ilI.,'!|]/.test(character)
              ? 0.6
              : /\s/.test(character)
                ? 0.6
                : /[A-Z0-9]/.test(character)
                  ? 1.4
                  : 1.2),
      0,
    );
  const words = value
    .trim()
    .split(/\s+/)
    .flatMap((word) => {
      const pieces: string[] = [];
      let piece = '';
      for (const character of word) {
        if (piece && units(piece + character) > width) {
          pieces.push(piece);
          piece = '';
        }
        piece += character;
      }
      if (piece) pieces.push(piece);
      return pieces;
    });
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && units(`${line} ${word}`) > width) {
      lines.push(line);
      line = '';
    }
    line += `${line ? ' ' : ''}${word}`;
  }
  if (line) lines.push(line);
  return lines;
}

/** Only this fixed template emits SVG. Every upstream field is escaped text. */
export function renderDocumentPage(image: SyntheticDocImage, documentName: string): string {
  const titleLines = wrap(image.title, 43);
  const title = titleLines
    .map(
      (line, index) =>
        `<text x="64" y="${156 + index * 38}" font-size="31" font-weight="700" fill="#111111">${escape(line)}</text>`,
    )
    .join('');
  const metadataY = Math.max(228, 156 + titleLines.length * 38 + 15);
  const metadataLines = wrap(documentName, 100);
  const metadataText = metadataLines
    .map(
      (line, index) =>
        `<text x="64" y="${metadataY + index * 18}" font-size="12" fill="#555555">${escape(line)}</text>`,
    )
    .join('');
  let y = metadataY + metadataLines.length * 18 + 46;
  const paragraphs = image.paragraphs
    .map((paragraph, index) => {
      const lines = wrap(paragraph, 76);
      const marker = `<circle cx="74" cy="${y - 5}" r="12" fill="#f2f2f2"/><text x="74" y="${y}" text-anchor="middle" font-size="12" font-weight="700" fill="#111111">${index + 1}</text>`;
      const text = lines
        .map(
          (line, i) =>
            `<text x="103" y="${y + i * 23}" font-size="16" fill="#333333">${escape(line)}</text>`,
        )
        .join('');
      y += lines.length * 23 + 32;
      return marker + text;
    })
    .join('');
  const height = Math.max(1056, y + 118);
  const footer = height - 86;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="816" height="${height}" viewBox="0 0 816 ${height}" role="img" aria-label="Synthetic training page ${image.pageNumber}">
  <rect width="816" height="${height}" fill="#ffffff"/>
  <rect width="816" height="10" fill="#e11a2b"/>
  <g font-family="Arial, Helvetica, sans-serif">
    <text x="64" y="66" font-size="25" font-weight="700" fill="#111111">macy's</text>
    <text x="181" y="64" font-size="11" letter-spacing="2" fill="#555555">ASSOCIATE COMMUNICATIONS</text>
    <rect x="64" y="93" width="231" height="25" rx="2" fill="#f2f2f2"/>
    <text x="75" y="110" font-size="10" font-weight="700" letter-spacing="1.2" fill="#c8102e">SYNTHETIC TRAINING ALERT</text>
    ${title}
    ${metadataText}
    <text x="64" y="${metadataY + metadataLines.length * 18}" font-size="12" fill="#555555">Page ${image.pageNumber} of ${image.pageCount}</text>
    ${paragraphs}
    <line x1="64" y1="${footer}" x2="752" y2="${footer}" stroke="#dddddd"/>
    <text x="64" y="${footer + 27}" font-size="11" fill="#555555">LOCAL DEMONSTRATION · INVENTED CONTENT · NOT AN OFFICIAL POLICY</text>
    <text x="752" y="${footer + 27}" text-anchor="end" font-size="11" fill="#555555">${image.pageNumber} / ${image.pageCount}</text>
  </g>
</svg>`;
}
