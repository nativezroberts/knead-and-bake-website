/**
 * Admin Page — login, skip date management, announcement management, news post management.
 */

const API_BASE = window.__API_BASE || '';
let authToken = null;

// ── Auth ──
async function login(password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');

  authToken = data.token;
  return data;
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };
}

async function authFetch(url, options = {}) {
  options.headers = { ...authHeaders(), ...options.headers };
  const res = await fetch(url, options);

  if (res.status === 401 || res.status === 403) {
    authToken = null;
    showLogin();
    throw new Error('Session expired. Please log in again.');
  }

  return res;
}

// ── DOM Helpers ──
function $(id) { return document.getElementById(id); }

function showLogin() {
  $('login-section').classList.remove('hidden');
  $('admin-content').classList.add('hidden');
  $('login-error').classList.add('hidden');
}

function showAdmin() {
  $('login-section').classList.add('hidden');
  $('admin-content').classList.remove('hidden');
  loadSkipDates();
  loadAnnouncements();
  loadNewsPosts();
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Skip Dates ──
async function loadSkipDates() {
  const container = $('skip-dates-list');
  container.innerHTML = '<p style="color:var(--text-secondary)">Loading...</p>';

  try {
    const res = await authFetch(`${API_BASE}/api/admin/skip-dates`);
    const data = await res.json();
    const skipDates = data.skipDates || [];

    if (skipDates.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary)">No skip dates configured.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Date</th><th>Reason</th><th></th></tr></thead>
        <tbody>
          ${skipDates.map(s => `
            <tr>
              <td>${s.date}</td>
              <td>${s.reason || '—'}</td>
              <td><button class="btn btn--sm btn--outline" onclick="deleteSkipDate('${s.date}')">Delete</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<p class="form-error">${e.message}</p>`;
  }
}

async function addSkipDate(e) {
  e.preventDefault();
  const dateInput = $('skip-date-input');
  const reasonInput = $('skip-reason-input');
  const errorEl = $('skip-date-error');
  errorEl.classList.add('hidden');

  const date = dateInput.value;
  const reason = reasonInput.value.trim();

  if (!date) {
    showError(errorEl, 'Please select a date.');
    return;
  }

  // Validate it's a Saturday
  const d = new Date(date + 'T12:00:00');
  if (d.getDay() !== 6) {
    showError(errorEl, 'Date must be a Saturday.');
    return;
  }

  try {
    const res = await authFetch(`${API_BASE}/api/admin/skip-dates`, {
      method: 'POST',
      body: JSON.stringify({ date, reason }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Failed to add skip date.');
    }

    dateInput.value = '';
    reasonInput.value = '';
    loadSkipDates();
  } catch (e) {
    showError(errorEl, e.message);
  }
}

window.deleteSkipDate = async function(date) {
  if (!confirm(`Remove skip date ${date}?`)) return;

  try {
    await authFetch(`${API_BASE}/api/admin/skip-dates/${encodeURIComponent(date)}`, {
      method: 'DELETE',
    });
    loadSkipDates();
  } catch (e) {
    alert('Failed to delete: ' + e.message);
  }
};

// ── Announcements ──
async function loadAnnouncements() {
  const container = $('announcements-list');
  container.innerHTML = '<p style="color:var(--text-secondary)">Loading...</p>';

  try {
    const res = await authFetch(`${API_BASE}/api/admin/announcements`);
    const data = await res.json();
    const announcements = data.announcements || [];

    if (announcements.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary)">No announcements.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Title</th><th>Message</th><th>Dates</th><th>Level</th><th>Active</th><th></th></tr></thead>
        <tbody>
          ${announcements.map(a => `
            <tr>
              <td>${a.title || '—'}</td>
              <td>${a.message}</td>
              <td>${a.startDate} to ${a.endDate}</td>
              <td>${a.level}</td>
              <td>${a.active ? 'Yes' : 'No'}</td>
              <td>
                <button class="btn btn--sm btn--outline" onclick="toggleAnnouncement('${a.id}', ${!a.active})">${a.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn btn--sm btn--outline" onclick="deleteAnnouncement('${a.id}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<p class="form-error">${e.message}</p>`;
  }
}

async function addAnnouncement(e) {
  e.preventDefault();
  const errorEl = $('announcement-error');
  errorEl.classList.add('hidden');

  const title = $('announcement-title').value.trim();
  const excerpt = $('announcement-excerpt').value.trim();
  const content = $('announcement-content').value.trim();
  const message = $('announcement-message').value.trim();
  const startDate = $('announcement-start').value;
  const endDate = $('announcement-end').value;
  const level = $('announcement-level').value;

  if (!title || !message || !startDate || !endDate) {
    showError(errorEl, 'Title, banner message, and dates are required.');
    return;
  }

  try {
    const res = await authFetch(`${API_BASE}/api/admin/announcements`, {
      method: 'POST',
      body: JSON.stringify({ title, excerpt, content, message, startDate, endDate, level, active: true }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Failed to create announcement.');
    }

    $('announcement-title').value = '';
    $('announcement-excerpt').value = '';
    $('announcement-content').value = '';
    $('announcement-message').value = '';
    $('announcement-start').value = '';
    $('announcement-end').value = '';
    loadAnnouncements();
  } catch (e) {
    showError(errorEl, e.message);
  }
}

window.toggleAnnouncement = async function(id, active) {
  try {
    await authFetch(`${API_BASE}/api/admin/announcements/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    });
    loadAnnouncements();
  } catch (e) {
    alert('Failed to update: ' + e.message);
  }
};

window.deleteAnnouncement = async function(id) {
  if (!confirm('Delete this announcement?')) return;

  try {
    await authFetch(`${API_BASE}/api/admin/announcements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    loadAnnouncements();
  } catch (e) {
    alert('Failed to delete: ' + e.message);
  }
};

// ── News Posts ──
async function loadNewsPosts() {
  const container = $('news-posts-list');
  container.innerHTML = '<p style="color:var(--text-secondary)">Loading...</p>';

  try {
    const res = await authFetch(`${API_BASE}/api/admin/news`);
    const data = await res.json();
    const posts = data.posts || [];

    if (posts.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary)">No news posts.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Title</th><th>Start</th><th>End</th><th>Active</th><th></th></tr></thead>
        <tbody>
          ${posts.map(p => `
            <tr>
              <td>${p.title || '—'}</td>
              <td>${p.startDate}</td>
              <td>${p.endDate || 'Indefinite'}</td>
              <td>${p.active ? 'Yes' : 'No'}</td>
              <td>
                <button class="btn btn--sm btn--outline" onclick="toggleNewsPost('${p.id}', ${!p.active})">${p.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn btn--sm btn--outline" onclick="deleteNewsPost('${p.id}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<p class="form-error">${e.message}</p>`;
  }
}

async function addNewsPost(e) {
  e.preventDefault();
  const errorEl = $('news-post-error');
  errorEl.classList.add('hidden');

  const title = $('news-post-title').value.trim();
  const subtitle = $('news-post-subtitle').value.trim();
  const excerpt = $('news-post-excerpt').value.trim();
  const content = $('news-post-content').value.trim();
  const startDate = $('news-post-start').value;
  const endDate = $('news-post-end').value;

  if (!title || !excerpt || !content || !startDate) {
    showError(errorEl, 'Title, excerpt, content, and start date are required.');
    return;
  }

  try {
    const payload = { title, subtitle, excerpt, content, startDate, active: true };
    if (endDate) payload.endDate = endDate;

    const res = await authFetch(`${API_BASE}/api/admin/news`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Failed to create news post.');
    }

    $('news-post-title').value = '';
    $('news-post-subtitle').value = '';
    $('news-post-excerpt').value = '';
    $('news-post-content').value = '';
    $('news-post-start').value = '';
    $('news-post-end').value = '';
    loadNewsPosts();
  } catch (e) {
    showError(errorEl, e.message);
  }
}

window.toggleNewsPost = async function(id, active) {
  try {
    await authFetch(`${API_BASE}/api/admin/news/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    });
    loadNewsPosts();
  } catch (e) {
    alert('Failed to update: ' + e.message);
  }
};

window.deleteNewsPost = async function(id) {
  if (!confirm('Delete this news post?')) return;

  try {
    await authFetch(`${API_BASE}/api/admin/news/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    loadNewsPosts();
  } catch (e) {
    alert('Failed to delete: ' + e.message);
  }
};

// ── Init ──
export function initAdmin() {
  // Login form
  const loginForm = $('login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('login-error');
    errorEl.classList.add('hidden');
    const password = $('admin-password').value;

    try {
      await login(password);
      showAdmin();
    } catch (err) {
      showError(errorEl, err.message);
    }
  });

  // Skip date form
  $('skip-date-form').addEventListener('submit', addSkipDate);

  // Announcement form
  $('announcement-form').addEventListener('submit', addAnnouncement);

  // News post form
  $('news-post-form').addEventListener('submit', addNewsPost);
}
