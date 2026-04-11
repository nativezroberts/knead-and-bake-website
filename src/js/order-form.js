/**
 * Order Form — handles item selection, form validation, submission,
 * and optional Square Web Payments card checkout.
 * Uses product-model.js as single source of truth for availability & status.
 */

import { loadProducts } from './product-model.js';
import { renderOrderItem } from './components.js';

const API_BASE = window.__API_BASE || '';
const PROCESSING_FEE_CENTS = 30;

export async function initOrderForm({ preorderOpen = true } = {}) {
  const container = document.getElementById('order-items');
  const form = document.getElementById('order-form');
  const summaryEl = document.getElementById('order-summary');
  const submitBtn = document.getElementById('order-submit');
  const successMsg = document.getElementById('order-success');
  const errorMsg = document.getElementById('order-error');

  // Payment flow elements
  const paymentChoice = document.getElementById('payment-choice');
  const paymentChoiceTotal = document.getElementById('payment-choice-total');
  const payNowBtn = document.getElementById('pay-now-btn');
  const payAtPickupBtn = document.getElementById('pay-at-pickup-btn');
  const cardSection = document.getElementById('card-payment-section');
  const cardSubtotal = document.getElementById('card-subtotal');
  const cardTotal = document.getElementById('card-total');
  const cardErrors = document.getElementById('card-errors');
  const cardPayBtn = document.getElementById('card-pay-btn');
  const cardBackBtn = document.getElementById('card-back-btn');
  const paymentSuccess = document.getElementById('payment-success');

  if (!container || !form) return;

  const productData = await loadProducts();

  if (!productData) {
    container.innerHTML = '<p>Unable to load menu. Please try again later.</p>';
    return;
  }

  // Preorder shows items where available=true (including sold_out).
  // Items with available=false (not_available) are hidden by renderOrderItem.
  const preorderItems = productData.items.filter(i => i.available);

  if (preorderItems.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary)">No items available for preorder right now. Check back soon!</p>';
    return;
  }

  container.innerHTML = preorderItems.map(renderOrderItem).join('');

  // Track quantities — only for orderable items (status === 'available')
  const quantities = {};
  const orderableItems = preorderItems.filter(i => i.status === 'available');
  orderableItems.forEach(item => { quantities[item.sku] = 0; });

  // Item click handlers
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.order-item__qty-btn');
    if (!btn) return;

    const row = btn.closest('.order-item');
    const sku = row.dataset.sku;
    const maxQty = parseInt(row.dataset.maxQty, 10) || 10;
    const action = btn.dataset.action;
    const qtyEl = row.querySelector('[data-qty]');

    if (action === 'increment') {
      quantities[sku] = Math.min((quantities[sku] || 0) + 1, maxQty);
    } else if (action === 'decrement') {
      quantities[sku] = Math.max((quantities[sku] || 0) - 1, 0);
    }

    qtyEl.textContent = quantities[sku];
    updateSummary();
  });

  function updateSummary() {
    const selected = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([sku, qty]) => {
        const item = orderableItems.find(i => i.sku === sku);
        return { sku, name: item.name, qty, subtotal: item.price * qty };
      });

    if (selected.length === 0) {
      summaryEl.innerHTML = '<p style="color:var(--text-secondary);font-size:var(--text-sm)">Select items above to build your order.</p>';
      submitBtn.disabled = true;
      return;
    }

    const total = selected.reduce((sum, s) => sum + s.subtotal, 0);
    summaryEl.innerHTML = `
      <ul style="list-style:none;margin-bottom:var(--space-4)">
        ${selected.map(s => `
          <li style="display:flex;justify-content:space-between;padding:var(--space-2) 0;font-size:var(--text-sm);border-bottom:1px solid var(--border-color)">
            <span>${s.qty}x ${s.name}</span>
            <span>$${s.subtotal.toFixed(2)}</span>
          </li>
        `).join('')}
      </ul>
      <div style="display:flex;justify-content:space-between;font-weight:var(--weight-bold)">
        <span>Estimated Total</span>
        <span>$${total.toFixed(2)}</span>
      </div>
      <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:var(--space-2)">
        <p>Pay online with card or at pickup (Venmo, cash, or card)</p>
      </div>
    `;
    submitBtn.disabled = !preorderOpen;
  }

  updateSummary();

  // ── Form submission ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!preorderOpen) {
      showError('Preorders are currently closed.');
      return;
    }

    // Check honeypot
    const hp = form.querySelector('[name="website"]');
    if (hp && hp.value) return;

    // Gather items
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([sku, qty]) => {
        const item = orderableItems.find(i => i.sku === sku);
        return { sku, name: item.name, qty };
      });

    if (items.length === 0) return;

    // Gather form data
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name')?.trim(),
      email: formData.get('email')?.trim() || '',
      phone: formData.get('phone')?.trim() || '',
      pickupDate: formData.get('pickup_date')?.trim(),
      items,
      notes: formData.get('notes')?.trim() || '',
    };

    // Basic client-side validation
    if (!payload.name || !payload.pickupDate) {
      showError('Please fill in all required fields.');
      return;
    }

    const phoneDigits = payload.phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      showError('Please enter a valid phone number (at least 10 digits).');
      return;
    }

    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      showError('Please enter a valid email address or leave it blank.');
      return;
    }

    // Submit order
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    errorMsg.classList.add('hidden');

    try {
      const res = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        if (res.status === 409 || data.unavailableItems) {
          showError(data.message || 'Some items sold out. Please refresh and try again.');
          setTimeout(() => window.location.reload(), 3000);
          return;
        }

        throw new Error(data.message || 'Something went wrong. Please try again.');
      }

      const data = await res.json();

      // Show payment choice
      form.classList.add('hidden');
      showPaymentChoice(data.orderId, data.totalCents);
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Place Preorder';
    }
  });

  // ── Payment choice flow ──
  function showPaymentChoice(orderId, totalCents) {
    const subtotalStr = `$${(totalCents / 100).toFixed(2)}`;
    const totalWithFee = `$${((totalCents + PROCESSING_FEE_CENTS) / 100).toFixed(2)}`;

    paymentChoiceTotal.textContent = `Order total: ${subtotalStr}`;
    paymentChoice.classList.remove('hidden');

    // Pay Now button
    payNowBtn.onclick = () => {
      paymentChoice.classList.add('hidden');
      showCardPayment(orderId, totalCents);
    };

    // Pay at Pickup button
    payAtPickupBtn.onclick = () => {
      paymentChoice.classList.add('hidden');
      successMsg.classList.remove('hidden');
    };
  }

  // ── Square card payment ──
  let squareCard = null;

  async function showCardPayment(orderId, totalCents) {
    const subtotalStr = `$${(totalCents / 100).toFixed(2)}`;
    const totalWithFee = (totalCents + PROCESSING_FEE_CENTS) / 100;

    cardSubtotal.textContent = subtotalStr;
    cardTotal.textContent = `$${totalWithFee.toFixed(2)}`;
    cardSection.classList.remove('hidden');

    // Back button returns to payment choice
    cardBackBtn.onclick = () => {
      cardSection.classList.add('hidden');
      showPaymentChoice(orderId, totalCents);
    };

    // Initialize Square card form
    try {
      if (!window.Square) {
        showCardError('Payment service is loading. Please wait a moment and try again.');
        return;
      }

      const payments = window.Square.payments(
        window.__SQUARE_APP_ID,
        window.__SQUARE_LOCATION_ID
      );

      if (!squareCard) {
        squareCard = await payments.card();
        await squareCard.attach('#card-container');
      }

      cardPayBtn.disabled = false;
    } catch (err) {
      console.error('Square card init error:', err);
      showCardError(`Unable to load payment form: ${err?.message || err}. Please try again or pay at pickup.`);
      return;
    }

    // Handle payment
    cardPayBtn.onclick = async () => {
      cardPayBtn.disabled = true;
      cardPayBtn.textContent = 'Processing...';
      cardErrors.classList.add('hidden');

      try {
        const result = await squareCard.tokenize();

        if (result.status !== 'OK') {
          throw new Error(result.errors?.[0]?.message || 'Card verification failed. Please check your card details.');
        }

        // Send payment to our API
        const payRes = await fetch(`${API_BASE}/api/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, nonce: result.token }),
        });

        const payData = await payRes.json();

        if (!payRes.ok) {
          throw new Error(payData.message || 'Payment failed. Please try again.');
        }

        // Payment success
        cardSection.classList.add('hidden');
        paymentSuccess.classList.remove('hidden');
      } catch (err) {
        showCardError(err.message);
        cardPayBtn.disabled = false;
        cardPayBtn.textContent = 'Complete Payment';
      }
    };
  }

  function showCardError(msg) {
    cardErrors.textContent = msg;
    cardErrors.classList.remove('hidden');
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
  }
}
