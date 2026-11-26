/**
 * Social image prompt email.
 *
 * When a news post or announcement is created, the owner gets an email with a
 * ready-to-paste prompt for Claude or ChatGPT, plus links to the brand assets
 * and three sample Instagram images to mimic.
 */

const SITE_URL = 'https://www.kneadandbaketx.com';
const IMG = `${SITE_URL}/images`;

export const SAMPLE_IMAGES = [
  { label: 'Sample A: Cream Classic', url: `${IMG}/social-samples/sample-a-cream-classic.jpg` },
  { label: 'Sample B: Bold Green', url: `${IMG}/social-samples/sample-b-bold-green.jpg` },
  { label: 'Sample C: Bakery Note', url: `${IMG}/social-samples/sample-c-bakery-note.jpg` },
];

export const BRAND_ASSETS = [
  { label: 'Logo', url: `${IMG}/logo-badge-400.png` },
  { label: 'Homemade Texas Verified badge', url: `${IMG}/homemade-texas-verified-400.png` },
  { label: 'Bread photo', url: `${IMG}/home-sourdough.jpg` },
  { label: 'Market stand photo', url: `${IMG}/KnBStandOpen.jpg` },
];

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 'YYYY-MM-DD' -> 'Saturday, Nov 28, 2026'. Returns '' for missing/invalid input. */
export function formatDisplayDate(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** Normalize a NEWS or ANNOUNCEMENT item into the fields the prompt needs. */
export function toAnnouncementDetails(item = {}) {
  const isNews = item.type === 'NEWS';
  const headline = (item.title || item.message || '').trim();
  const lines = [
    isNews ? item.subtitle : '',
    !isNews && item.message !== headline ? item.message : '',
    item.excerpt,
    item.content,
  ].map(s => (s || '').trim()).filter(Boolean);
  return {
    kind: isNews ? 'News post' : 'Announcement',
    headline,
    body: [...new Set(lines)].join('\n\n'),
    startDate: formatDisplayDate(item.startDate),
    endDate: item.endDate && item.endDate !== item.startDate ? formatDisplayDate(item.endDate) : '',
  };
}

export function buildSocialPrompt(details) {
  const when = details.startDate
    ? `${details.startDate}${details.endDate ? ` through ${details.endDate}` : ''}`
    : '(no date given)';
  return [
    'Create 3 different Instagram post images (1080x1350 px, portrait 4:5) for my bakery, Knead & Bake TX, announcing the following. Use the 3 attached sample images as style references: one new image in the style of each sample. Match their layout ideas, colors and fonts, but rewrite every word for this announcement.',
    '',
    'ANNOUNCEMENT',
    `Headline: ${details.headline || '(none)'}`,
    `Posted on our website: ${when} (use the details below for the actual event dates)`,
    details.body ? `Details:\n${details.body}` : '',
    '',
    'BRAND',
    '- Colors: forest green #105433, gold #DEA528, cream #FBF7EF, cranberry #8E2B3A, dark ink #1F2420',
    '- Fonts: Fraunces (bold, soft serif) for headlines, Montserrat for small text',
    '- Include the attached Knead & Bake logo and the "Homemade Texas Verified" badge on every image',
    '- Use the attached bread or market photos where they fit',
    '- Market: Castell Street Market, 209 S Castell Ave, New Braunfels. Saturdays 9 AM to 1 PM (unless the announcement says otherwise)',
    '- Call to action: Preorder at kneadandbaketx.com',
    '',
    'RULES',
    '- Spell everything exactly as written above, especially dates, times and the web address',
    '- Write the real day and date on the image (e.g. "Sat, Nov 28"), not just "this weekend"',
    '- Keep text big and readable on a phone, with nothing cut off at the edges',
    '',
    'Also write a short, friendly Instagram caption with 1 or 2 emojis.',
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
}

export function buildSocialPromptEmail(item) {
  const details = toAnnouncementDetails(item);
  const prompt = buildSocialPrompt(details);
  const subject = `Make Instagram images: ${details.headline || details.kind}`.slice(0, 150);

  const steps = [
    'Save the 3 sample images and the brand assets below (tap and hold, then Save Image).',
    'Open Claude or ChatGPT and attach those images.',
    'Copy the prompt below, paste it in, and send.',
    'Pick your favorite of the 3 and post it to Instagram.',
  ];

  const text = [
    `New ${details.kind.toLowerCase()} saved: "${details.headline}"`,
    '',
    'Make your Instagram images:',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'SAMPLE IMAGES TO MIMIC',
    ...SAMPLE_IMAGES.map(s => `- ${s.label}: ${s.url}`),
    '',
    'BRAND ASSETS',
    ...BRAND_ASSETS.map(a => `- ${a.label}: ${a.url}`),
    '',
    '----- PROMPT (copy everything below) -----',
    prompt,
  ].join('\n');

  const sampleCells = SAMPLE_IMAGES.map(s => `
    <td style="width:33%;padding:4px;vertical-align:top;text-align:center;">
      <a href="${s.url}"><img src="${s.url}" alt="${esc(s.label)}" width="200" style="width:100%;max-width:200px;border-radius:10px;border:1px solid #e6dcc8;display:block;margin:0 auto;"></a>
      <div style="font:600 12px Arial,sans-serif;color:#635F55;margin-top:6px;">${esc(s.label)}</div>
    </td>`).join('');

  const assetLinks = BRAND_ASSETS
    .map(a => `<a href="${a.url}" style="color:#105433;font-weight:700;">${esc(a.label)}</a>`)
    .join(' &middot; ');

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#FBF7EF;font-family:Arial,sans-serif;color:#1F2420;">
<div style="padding:24px 12px;">
<div style="max-width:680px;margin:0 auto;background:#FFFDF9;border:1px solid #E6DCC8;border-radius:20px;overflow:hidden;">
  <div style="padding:24px;background:#105433;color:#FBF7EF;text-align:center;">
    <div style="font-size:12px;font-weight:700;letter-spacing:.14em;color:#DEA528;">NEW ${esc(details.kind.toUpperCase())} SAVED</div>
    <h1 style="margin:10px 0 6px;font-family:Georgia,serif;font-size:26px;line-height:1.2;">${esc(details.headline)}</h1>
    <div style="font-size:14px;color:#F5E6C0;">Time to make the Instagram post</div>
  </div>
  <div style="padding:22px 22px 8px;">
    <ol style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:1.6;">
      ${steps.map(s => `<li>${esc(s)}</li>`).join('')}
    </ol>
    <div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#8E2B3A;margin-bottom:8px;">SAMPLE IMAGES TO MIMIC</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${sampleCells}</tr></table>
    <p style="font-size:14px;line-height:1.6;margin:16px 0;"><b>Brand assets:</b> ${assetLinks}</p>
    <div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#8E2B3A;margin:18px 0 8px;">PROMPT TO COPY</div>
    <pre style="white-space:pre-wrap;word-wrap:break-word;background:#F3EBDC;border:1px solid #E6DCC8;border-radius:12px;padding:16px;font:13px/1.55 Menlo,Consolas,monospace;color:#1F2420;margin:0 0 22px;">${esc(prompt)}</pre>
  </div>
</div></div></body></html>`;

  return { subject, text, html, prompt };
}
