/**
 * Reusable UI Components — render functions that return HTML strings.
 */

export function renderCard({ name, description, price, allergens, image, available, seasonal, seasonalLabel, topSeller }) {
  const tagHtml = seasonal
    ? `<span class="card__tag card__tag--seasonal">${seasonalLabel || 'Seasonal'}</span>`
    : topSeller
      ? `<span class="card__tag">Top Seller</span>`
      : '';

  const availBadge = available
    ? '<span class="badge badge--available">Available</span>'
    : '<span class="badge badge--unavailable">Sold Out</span>';

  const allergenText = allergens && allergens.length
    ? `<span class="card__allergens">Contains: ${allergens.join(', ')}</span>`
    : '';

  return `
    <article class="card${!available ? ' card--unavailable' : ''}">
      <img class="card__image" src="${image || '/images/placeholder-bread.svg'}"
           alt="${name}" loading="lazy" width="400" height="300">
      <div class="card__body">
        ${tagHtml}
        <h3 class="card__title">${name}</h3>
        <p class="card__desc">${description}</p>
        <div class="card__meta">
          <span class="card__price">$${price.toFixed(2)}</span>
          ${availBadge}
        </div>
        ${allergenText ? `<p class="mt-4">${allergenText}</p>` : ''}
      </div>
    </article>
  `;
}

export function renderTestimonial({ text, author, source }) {
  return `
    <blockquote class="testimonial">
      <p class="testimonial__text">${text}</p>
      <footer class="testimonial__author">${author}${source ? ` — ${source}` : ''}</footer>
    </blockquote>
  `;
}

export function renderNewsItem({ slug, title, date, excerpt, detailUrl }) {
  const d = new Date(date + 'T00:00:00');
  const formatted = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const url = detailUrl || (slug ? `/news/${slug}.html` : null);
  const titleHtml = url
    ? `<a href="${url}">${title}</a>`
    : title;
  const readMore = url
    ? `<a href="${url}" class="btn btn--sm btn--outline mt-4">Read more</a>`
    : '';
  return `
    <article class="news-item">
      <time class="news-item__date" datetime="${date}">${formatted}</time>
      <h3 class="news-item__title">${titleHtml}</h3>
      ${excerpt ? `<p class="news-item__excerpt">${excerpt}</p>` : ''}
      ${readMore}
    </article>
  `;
}

export function renderRecipeCard({ slug, title, description, image, difficulty, bakeTime }) {
  return `
    <a href="/recipes/${slug}.html" class="card" style="text-decoration:none">
      <img class="card__image" src="${image || '/images/placeholder-bread.svg'}"
           alt="${title}" loading="lazy" width="400" height="300">
      <div class="card__body">
        <span class="card__tag">${difficulty}</span>
        <h3 class="card__title">${title}</h3>
        <p class="card__desc">${description}</p>
        <div class="card__meta">
          <span style="font-size:var(--text-sm);color:var(--text-secondary)">Bake: ${bakeTime}</span>
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
            ${item.question}
            <svg class="accordion__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/>
            </svg>
          </summary>
          <div class="accordion__content">
            <p>${item.answer}</p>
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
        <div class="next-market__date">${nextMarket.date}</div>
        <div class="next-market__location">${nextMarket.time} · ${nextMarket.location}</div>
      </div>
      <a href="/preorder.html" class="btn btn--primary btn--sm">Preorder Now</a>
    </div>
  `;
}

export function renderDayCard(day) {
  return `
    <div class="day-card">
      <div class="day-card__number">${day.day}</div>
      <h3 class="day-card__title">${day.title}</h3>
      <p class="card__desc">${day.summary}</p>
      <ol class="day-card__steps">
        ${day.steps.map(s => `<li>${s}</li>`).join('')}
      </ol>
      ${day.whatToExpect ? `<p class="mt-4" style="font-size:var(--text-sm);color:var(--text-secondary)"><strong>What to expect:</strong> ${day.whatToExpect}</p>` : ''}
    </div>
  `;
}

export function renderAnnouncementBanner(announcement) {
  const levelClass = announcement.level === 'warning' ? 'banner--warning' : 'banner--info';
  return `
    <div class="banner ${levelClass} mb-4" role="alert">
      ${announcement.message}
    </div>
  `;
}

export function renderAnnouncementBlurb(announcement) {
  const d = new Date(announcement.startDate + 'T00:00:00');
  const formatted = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const icon = announcement.level === 'warning' ? 'Important' : 'Announcement';
  return `
    <article class="news-item">
      <time class="news-item__date" datetime="${announcement.startDate}">${formatted}</time>
      <h3 class="news-item__title">${icon}: ${announcement.message}</h3>
    </article>
  `;
}

export function renderSkipNotice(reason, nextAvailableDate) {
  return `
    <div class="banner banner--warning mb-4" role="alert">
      <strong>No market this Saturday.</strong> ${reason ? reason + ' ' : ''}
      Our next market is ${nextAvailableDate}.
    </div>
  `;
}

export function renderOrderItem(item) {
  if (!item.available) return '';
  return `
    <div class="order-item" data-sku="${item.sku}">
      <div class="order-item__info">
        <div class="order-item__name">${item.name}</div>
        <div class="order-item__price">$${item.price.toFixed(2)}</div>
      </div>
      <div class="order-item__qty">
        <button type="button" class="order-item__qty-btn" data-action="decrement" aria-label="Remove one ${item.name}">−</button>
        <span class="order-item__qty-val" data-qty>0</span>
        <button type="button" class="order-item__qty-btn" data-action="increment" aria-label="Add one ${item.name}">+</button>
      </div>
    </div>
  `;
}
