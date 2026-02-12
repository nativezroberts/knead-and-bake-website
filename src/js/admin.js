/**
 * Admin Page — login, skip date management, announcement management, news post management.
 */

const API_BASE = window.__API_BASE || '';
let authToken = null;
let editingAnnouncementId = null;
let editingNewsPostId = null;
let announcementsCache = [];
let newsPostsCache = [];

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
  resetAnnouncementForm();
  resetNewsPostForm();
  loadSkipDates();
  loadAnnouncements();
  loadNewsPosts();
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function resetAnnouncementForm() {
  editingAnnouncementId = null;
  $('announcement-form-title').textContent = 'New Announcement';
  $('announcement-submit-btn').textContent = 'Add';
  $('announcement-cancel-edit-btn').classList.add('hidden');
  $('announcement-error').classList.add('hidden');
  $('announcement-title').value = '';
  $('announcement-excerpt').value = '';
  $('announcement-content').value = '';
  $('announcement-message').value = '';
  $('announcement-start').value = '';
  $('announcement-end').value = '';
  $('announcement-level').value = 'info';
}

function startAnnouncementEdit(announcement) {
  editingAnnouncementId = announcement.id;
  $('announcement-form-title').textContent = 'Edit Announcement';
  $('announcement-submit-btn').textContent = 'Save Changes';
  $('announcement-cancel-edit-btn').classList.remove('hidden');
  $('announcement-error').classList.add('hidden');
  $('announcement-title').value = announcement.title || '';
  $('announcement-excerpt').value = announcement.excerpt || '';
  $('announcement-content').value = announcement.content || '';
  $('announcement-message').value = announcement.message || '';
  $('announcement-start').value = announcement.startDate || '';
  $('announcement-end').value = announcement.endDate || '';
  $('announcement-level').value = announcement.level === 'warning' ? 'warning' : 'info';
}

function resetNewsPostForm() {
  editingNewsPostId = null;
  $('news-post-form-title').textContent = 'New Post';
  $('news-post-submit-btn').textContent = 'Add';
  $('news-post-cancel-edit-btn').classList.add('hidden');
  $('news-post-error').classList.add('hidden');
  $('news-post-title').value = '';
  $('news-post-subtitle').value = '';
  $('news-post-excerpt').value = '';
  $('news-post-content').value = '';
  $('news-post-start').value = '';
  $('news-post-end').value = '';
}

function startNewsPostEdit(post) {
  editingNewsPostId = post.id;
  $('news-post-form-title').textContent = 'Edit Post';
  $('news-post-submit-btn').textContent = 'Save Changes';
  $('news-post-cancel-edit-btn').classList.remove('hidden');
  $('news-post-error').classList.add('hidden');
  $('news-post-title').value = post.title || '';
  $('news-post-subtitle').value = post.subtitle || '';
  $('news-post-excerpt').value = post.excerpt || '';
  $('news-post-content').value = post.content || '';
  $('news-post-start').value = post.startDate || '';
  $('news-post-end').value = post.endDate || '';
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
    announcementsCache = announcements;

    if (editingAnnouncementId && !announcements.some(a => a.id === editingAnnouncementId)) {
      resetAnnouncementForm();
    }

    if (announcements.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary)">No announcements.</p>';
      resetAnnouncementForm();
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
                <button class="btn btn--sm btn--outline" onclick="editAnnouncement('${a.id}')">Edit</button>
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

  if (startDate > endDate) {
    showError(errorEl, 'Start date must be before end date.');
    return;
  }

  try {
    const isEditing = !!editingAnnouncementId;
    const url = isEditing
      ? `${API_BASE}/api/admin/announcements/${encodeURIComponent(editingAnnouncementId)}`
      : `${API_BASE}/api/admin/announcements`;
    const method = isEditing ? 'PUT' : 'POST';
    const payload = { title, excerpt, content, message, startDate, endDate, level };
    if (!isEditing) payload.active = true;

    const res = await authFetch(url, {
      method,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || (isEditing ? 'Failed to update announcement.' : 'Failed to create announcement.'));
    }

    resetAnnouncementForm();
    loadAnnouncements();
  } catch (e) {
    showError(errorEl, e.message);
  }
}

window.editAnnouncement = function(id) {
  const announcement = announcementsCache.find(a => a.id === id);
  if (!announcement) {
    alert('Announcement not found.');
    return;
  }
  startAnnouncementEdit(announcement);
};

window.cancelAnnouncementEdit = function() {
  resetAnnouncementForm();
};

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
    if (editingAnnouncementId === id) {
      resetAnnouncementForm();
    }
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
    newsPostsCache = posts;

    if (editingNewsPostId && !posts.some(p => p.id === editingNewsPostId)) {
      resetNewsPostForm();
    }

    if (posts.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary)">No news posts.</p>';
      resetNewsPostForm();
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
                <button class="btn btn--sm btn--outline" onclick="editNewsPost('${p.id}')">Edit</button>
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

  if (endDate && startDate > endDate) {
    showError(errorEl, 'Start date must be before end date.');
    return;
  }

  try {
    const isEditing = !!editingNewsPostId;
    const payload = { title, subtitle, excerpt, content, startDate };
    if (isEditing) {
      payload.endDate = endDate || null;
    } else {
      payload.active = true;
      if (endDate) payload.endDate = endDate;
    }

    const res = await authFetch(
      isEditing
        ? `${API_BASE}/api/admin/news/${encodeURIComponent(editingNewsPostId)}`
        : `${API_BASE}/api/admin/news`,
      {
        method: isEditing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || (isEditing ? 'Failed to update news post.' : 'Failed to create news post.'));
    }

    resetNewsPostForm();
    loadNewsPosts();
  } catch (e) {
    showError(errorEl, e.message);
  }
}

window.editNewsPost = function(id) {
  const post = newsPostsCache.find(p => p.id === id);
  if (!post) {
    alert('News post not found.');
    return;
  }
  startNewsPostEdit(post);
};

window.cancelNewsPostEdit = function() {
  resetNewsPostForm();
};

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
    if (editingNewsPostId === id) {
      resetNewsPostForm();
    }
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
  $('announcement-cancel-edit-btn').addEventListener('click', window.cancelAnnouncementEdit);

  // News post form
  $('news-post-form').addEventListener('submit', addNewsPost);
  $('news-post-cancel-edit-btn').addEventListener('click', window.cancelNewsPostEdit);
}
