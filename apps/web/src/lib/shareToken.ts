// Extract a share token from a pasted string. Accepts:
//   - a full URL containing `/s/<token>` (e.g. https://fastqbank.com/s/AbC...)
//   - a bare 12-character URL-safe token
// Returns null on anything else (trimming is applied first).
//
// The regex anchors on the `/s/` segment so a URL like
// `https://example.com/path/s/AbC_-123aZ09/extra` extracts cleanly.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TOKEN_RE = /[A-Za-z0-9_-]{12}/;
const URL_TOKEN_RE = /\/s\/([A-Za-z0-9_-]{12})\b/;

export function extractShareToken(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const urlMatch = s.match(URL_TOKEN_RE);
  if (urlMatch) return urlMatch[1];

  // Bare-token path: the entire string must BE a 12-char token (not
  // merely contain one — otherwise pasting "see https://other.com/foo"
  // would extract "ttps://othe" from the middle).
  if (/^[A-Za-z0-9_-]{12}$/.test(s)) return s;
  return null;
}
