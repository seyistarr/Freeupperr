export default function handler(req, res) {
  res.setHeader(
    'Cache-Control',
    'public, max-age=86400, immutable'
  );

  res.setHeader(
    'Content-Type',
    'image/svg+xml; charset=utf-8'
  );

  const svg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="1200"
  height="630"
  viewBox="0 0 1200 630"
>
  <rect width="1200" height="630" fill="#ffffff"/>

  <circle
    cx="600"
    cy="250"
    r="92"
    fill="#8b5cf6"
  />

  <text
    x="600"
    y="390"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="58"
    font-weight="700"
    fill="#111111"
  >
    FreeUpper
  </text>

  <text
    x="600"
    y="450"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="30"
    fill="#666666"
  >
    Connect. Share. Be Free.
  </text>
</svg>`;

  return res.status(200).send(svg);
}
