/**
 * /text.html — bridge from the owner email to Messages.
 * Email apps often block sms: links, so the email links here with the details in
 * the URL #fragment (never sent to the server). This page opens Messages with the
 * text filled in, and keeps an editable preview + copy fallback on screen.
 */
import { buildSmsHref, normalizeUsPhone } from './text-confirmation.js';

const params = new URLSearchParams(window.location.hash.slice(1));
const phone = params.get('to') || '';
const name = params.get('name') || 'your customer';
const body = params.get('body') || '';

const els = {
  heading: document.getElementById('text-heading'),
  phone: document.getElementById('text-phone'),
  message: document.getElementById('text-message'),
  open: document.getElementById('text-open'),
  copy: document.getElementById('text-copy'),
  status: document.getElementById('text-status'),
  error: document.getElementById('text-error'),
  form: document.getElementById('text-form'),
};

function currentHref() {
  return buildSmsHref(phone, els.message.value);
}

if (!normalizeUsPhone(phone) || !body) {
  els.form.hidden = true;
  els.error.hidden = false;
} else {
  els.heading.textContent = `Text ${name}`;
  els.phone.textContent = phone;
  els.message.value = body;
  els.open.href = currentHref();
  els.message.addEventListener('input', () => { els.open.href = currentHref(); });

  els.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.message.value);
      els.status.textContent = 'Copied! Paste it into a text to ' + phone + '.';
    } catch {
      els.message.select();
      els.status.textContent = 'Select the message above and copy it.';
    }
  });

  // Jump straight into Messages; the page stays as a fallback if the app blocks it.
  window.location.href = els.open.href;
}
