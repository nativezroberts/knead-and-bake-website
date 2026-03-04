/**
 * Reusable UI Components — render functions that return HTML strings.
 */

import { STATUS_LABEL } from './product-model.js';

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCard({ name, description, price, allergens, image, available, seasonal, seasonalLabel, topSeller, status }) {
  // Compute display status — prefer explicit `status` from product-model,
  // fall back to legacy `available` boolean for backward compat.
  const displayStatus = status || (available ? 'available' : 'not_available');
  const label = STATUS_LABEL[displayStatus] || STATUS_LABEL.not_available;

  const badgeClass =
    displayStatus === 'available'     ? 'badge--available' :
    displayStatus === 'sold_out'      ? 'badge--sold-out'  :
                                        'badge--unavailable';

  const tagHtml = seasonal
    ? `<span class="card__tag card__tag--seasonal">${escapeHtml(seasonalLabel || 'Seasonal')}</span>`
    : topSeller
      ? `<span class="card__tag">Top Seller</span>`
      : '';

  const allergenText = allergens && allergens.length
    ? `<span class="card__allergens">Contains: ${escapeHtml(allergens.join(', '))}</span>`
    : '';

  const safeName = escapeHtml(name);
  const safeImage = escapeHtml(image || '/images/placeholder-bread.svg');
  const safeImageWebp = image ? escapeHtml(image.replace(/\.(png|jpe?g)$/i, '.webp')) : '';

  return `
    <article class="card${displayStatus !== 'available' ? ' card--unavailable' : ''}">
      <picture>
        ${safeImageWebp ? `<source srcset="${safeImageWebp}" type="image/webp">` : ''}
        <img class="card__image" src="${safeImage}"
             alt="${safeName}" loading="lazy" width="400" height="300">
      </picture>
      <div class="card__body">
        ${tagHtml}
        <h3 class="card__title">${safeName}</h3>
        <p class="card__desc">${escapeHtml(description)}</p>
        <div class="card__meta">
          <span class="card__price">$${price.toFixed(2)}</span>
          <span class="badge ${badgeClass}">${label}</span>
        </div>
        ${allergenText ? `<p class="mt-4">${allergenText}</p>` : ''}
      </div>
    </article>
  `;
}

export function renderTestimonial({ text, author, source }) {
  return `
    <blockquote class="testimonial">
      <p class="testimonial__text">${escapeHtml(text)}</p>
      <footer class="testimonial__author">${escapeHtml(author)}${source ? ` — ${escapeHtml(source)}` : ''}</footer>
    </blockquote>
  `;
}

function formatNewsDate(value) {
  const raw = String(value || '').slice(0, 10);
  const parsed = raw ? new Date(`${raw}T00:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { display: 'Date unavailable', datetime: '' };
  }
  return {
    display: parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    datetime: raw,
  };
}

export function renderNewsItem({ id, title, subtitle, startDate, excerpt, type }) {
  const { display: formatted, datetime } = formatNewsDate(startDate);
  const url = `/news-detail.html?id=${encodeURIComponent(id)}`;
  const badge = type === 'announcement' ? '<span class="news-item__badge">Announcement</span> ' : '';
  return `
    <article class="news-item">
      <time class="news-item__date" datetime="${escapeHtml(datetime)}">${badge}${formatted}</time>
      <h3 class="news-item__title"><a href="${url}">${escapeHtml(title)}</a></h3>
      ${subtitle ? `<p class="news-item__subtitle">${escapeHtml(subtitle)}</p>` : ''}
      ${excerpt ? `<p class="news-item__excerpt">${escapeHtml(excerpt)}</p>` : ''}
      <a href="${url}" class="btn btn--sm btn--outline mt-4">Read more</a>
    </article>
  `;
}

export function renderRecipeCard({ slug, title, description, image, difficulty, bakeTime }) {
  const safeTitle = escapeHtml(title);
  const safeImage = escapeHtml(image || '/images/placeholder-bread.svg');
  const safeImageWebp = image ? escapeHtml(image.replace(/\.(png|jpe?g)$/i, '.webp')) : '';
  return `
    <a href="/recipes/${encodeURIComponent(slug)}.html" class="card" style="text-decoration:none">
      <picture>
        ${safeImageWebp ? `<source srcset="${safeImageWebp}" type="image/webp">` : ''}
        <img class="card__image" src="${safeImage}"
             alt="${safeTitle}" loading="lazy" width="400" height="300">
      </picture>
      <div class="card__body">
        <span class="card__tag">${escapeHtml(difficulty)}</span>
        <h3 class="card__title">${safeTitle}</h3>
        <p class="card__desc">${escapeHtml(description)}</p>
        <div class="card__meta">
          <span style="font-size:var(--text-sm);color:var(--text-secondary)">Bake: ${escapeHtml(bakeTime)}</span>
        </div>
      </div>
    </a>
  `;
}

export function renderAccordion(items) {
  return `
    <div class="accordion">
      ${items.map((item, i) => `
        <details class="accordion__item"${i === 0 ? ' open' : ''}>
          <summary class="accordion__trigger">
            ${escapeHtml(item.question)}
            <svg class="accordion__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/>
            </svg>
          </summary>
          <div class="accordion__content">
            <p>${escapeHtml(item.answer)}</p>
          </div>
        </details>
      `).join('')}
    </div>
  `;
}

export function renderNextMarket(nextMarket) {
  if (!nextMarket) return '';
  return `
    <div class="next-market">
      <div class="next-market__icon" aria-hidden="true">📅</div>
      <div class="next-market__info">
        <div class="next-market__label">Next Market</div>
        <div class="next-market__date">${escapeHtml(nextMarket.date)}</div>
        <div class="next-market__location">${escapeHtml(nextMarket.time)} · ${escapeHtml(nextMarket.location)}</div>
      </div>
      <a href="/preorder.html" class="btn btn--primary btn--sm">Preorder Now</a>
    </div>
  `;
}

export function renderDayCard(day) {
  return `
    <div class="day-card">
      <div class="day-card__number">${escapeHtml(day.day)}</div>
      <h3 class="day-card__title">${escapeHtml(day.title)}</h3>
      <p class="card__desc">${escapeHtml(day.summary)}</p>
      <ol class="day-card__steps">
        ${day.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ol>
      ${day.whatToExpect ? `<p class="mt-4" style="font-size:var(--text-sm);color:var(--text-secondary)"><strong>What to expect:</strong> ${escapeHtml(day.whatToExpect)}</p>` : ''}
    </div>
  `;
}

export function renderAnnouncementBanner(announcement) {
  const levelClass = announcement.level === 'warning' ? 'banner--warning' : 'banner--info';
  return `
    <div class="banner ${levelClass} mb-4" role="alert">
      ${escapeHtml(announcement.message)}
    </div>
  `;
}

export function renderSkipNotice(reason, nextAvailableDate) {
  return `
    <div class="banner banner--warning mb-4" role="alert">
      <strong>No market this Saturday.</strong> ${reason ? escapeHtml(reason) + ' ' : ''}
      Our next market is ${escapeHtml(nextAvailableDate)}.
    </div>
  `;
}

export function renderOrderItem(item) {
  const isSoldOut = item.status === 'sold_out';

  // If available=false (not_available), hide entirely from preorder
  if (item.status === 'not_available') return '';

  const safeName = escapeHtml(item.name);
  const safeSku = escapeHtml(item.sku);

  // Sold out: show row but disable controls
  if (isSoldOut) {
    return `
      <div class="order-item order-item--sold-out" data-sku="${safeSku}" data-max-qty="0">
        <div class="order-item__info">
          <div>
            <div class="order-item__name">${safeName}</div>
            <span class="badge badge--sold-out" style="font-size:var(--text-xs)">SOLD OUT</span>
          </div>
          <div class="order-item__price">$${item.price.toFixed(2)}</div>
        </div>
      </div>
    `;
  }

  const qtyLabel = item.currentQty !== undefined
    ? item.currentQty <= 5
      ? `<span style="color:var(--color-warning, #b45309);font-size:var(--text-xs)">Only ${item.currentQty} left</span>`
      : `<span style="color:var(--text-secondary);font-size:var(--text-xs)">${item.currentQty} available</span>`
    : '';

  return `
    <div class="order-item" data-sku="${safeSku}" data-max-qty="${item.currentQty || 10}">
      <div class="order-item__info">
        <div>
          <div class="order-item__name">${safeName}</div>
          ${qtyLabel}
        </div>
        <div class="order-item__price">$${item.price.toFixed(2)}</div>
      </div>
      <div class="order-item__qty">
        <button type="button" class="order-item__qty-btn" data-action="decrement" aria-label="Remove one ${safeName}">−</button>
        <span class="order-item__qty-val" data-qty>0</span>
        <button type="button" class="order-item__qty-btn" data-action="increment" aria-label="Add one ${safeName}">+</button>
      </div>
    </div>
  `;
}
