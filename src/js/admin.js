/**
 * Admin Page - login, skip date management, announcement management, news post management, product inventory.
 */

import { renderMarkdown } from './markdown.js';

const API_BASE = window.__API_BASE || '';
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

let authToken = null;
let editingAnnouncementId = null;
let editingNewsPostId = null;
let announcementsCache = [];
let newsPostsCache = [];
let inventoryCache = [];

// -- Auth --
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

// -- DOM Helpers --
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
  loadInventory();
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setUploadStatus(statusElId, msg, isError = false) {
  const el = $(statusElId);
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--color-error)' : 'var(--text-secondary)';
}

function updatePreview(textareaId, previewId) {
  const contentEl = $(textareaId);
  const previewEl = $(previewId);
  if (!contentEl || !previewEl) return;
  previewEl.innerHTML = renderMarkdown(contentEl.value || '');
}

function updateNewsPreview() {
  updatePreview('news-post-content', 'news-post-preview');
}

function updateAnnouncementPreview() {
  updatePreview('announcement-content', 'announcement-preview');
}

function insertAtCursor(textarea, text, onUpdate) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.setRangeText(text, start, end, 'end');
  textarea.focus();
  if (onUpdate) onUpdate();
}

function wrapSelection(textarea, before, after, placeholder, onUpdate) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const selected = textarea.value.slice(start, end);
  const inner = selected || placeholder;
  const replacement = `${before}${inner}${after}`;
  textarea.setRangeText(replacement, start, end, 'end');

  if (!selected) {
    const cursorStart = start + before.length;
    const cursorEnd = cursorStart + inner.length;
    textarea.setSelectionRange(cursorStart, cursorEnd);
  }

  textarea.focus();
  if (onUpdate) onUpdate();
}

function prefixSelectedLines(textarea, prefixFn, onUpdate) {
  const value = textarea.value;
  const selectionStart = textarea.selectionStart ?? 0;
  const selectionEnd = textarea.selectionEnd ?? value.length;
  const blockStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const blockEndIdx = value.indexOf('\n', selectionEnd);
  const blockEnd = blockEndIdx === -1 ? value.length : blockEndIdx;
  const block = value.slice(blockStart, blockEnd);

  const prefixed = block
    .split('\n')
    .map((line, idx) => {
      if (!line.trim()) return line;
      return prefixFn(line, idx);
    })
    .join('\n');

  textarea.setRangeText(prefixed, blockStart, blockEnd, 'select');
  textarea.focus();
  if (onUpdate) onUpdate();
}

function getSafeAltFromFileName(fileName) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'News image';
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
  const imageInput = $('announcement-image-file');
  if (imageInput) imageInput.value = '';
  setUploadStatus('announcement-upload-status', '');
  updateAnnouncementPreview();
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
  const imageInput = $('announcement-image-file');
  if (imageInput) imageInput.value = '';
  setUploadStatus('announcement-upload-status', '');
  updateAnnouncementPreview();
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
  const imageInput = $('news-post-image-file');
  if (imageInput) imageInput.value = '';
  setUploadStatus('news-post-upload-status', '');
  updateNewsPreview();
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
  const imageInput = $('news-post-image-file');
  if (imageInput) imageInput.value = '';
  setUploadStatus('news-post-upload-status', '');
  updateNewsPreview();
}

// -- Skip Dates --
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
              <td>${s.reason || '-'}</td>
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

  // Validate it is a Saturday
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

// -- Announcements --
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
              <td>${a.title || '-'}</td>
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

// -- News Posts --
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
              <td>${p.title || '-'}</td>
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

async function uploadImage(file, textareaId, onUpdate) {
  const contentEl = $(textareaId);
  if (!contentEl) return;

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Please upload PNG, JPG, WEBP, or GIF images only.');
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Image is too large. Maximum file size is 5 MB.');
  }

  const prepareRes = await authFetch(`${API_BASE}/api/admin/news/upload-url`, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });

  const prepareData = await prepareRes.json();
  if (!prepareRes.ok) {
    throw new Error(prepareData.message || 'Failed to prepare image upload.');
  }

  const putRes = await fetch(prepareData.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
    },
    body: file,
  });

  if (!putRes.ok) {
    throw new Error('Image upload failed. Please try again.');
  }

  const altText = getSafeAltFromFileName(file.name);
  const markdown = `\n\n![${altText}](${prepareData.publicUrl})\n\n`;
  insertAtCursor(contentEl, markdown, onUpdate);
}

function handleMarkdownAction(action, textareaId, onUpdate) {
  const textarea = $(textareaId);
  if (!textarea) return;

  if (action === 'bold') {
    wrapSelection(textarea, '**', '**', 'bold text', onUpdate);
    return;
  }

  if (action === 'italic') {
    wrapSelection(textarea, '*', '*', 'italic text', onUpdate);
    return;
  }

  if (action === 'heading') {
    prefixSelectedLines(textarea, (line) => {
      if (line.startsWith('## ')) return line;
      return `## ${line}`;
    }, onUpdate);
    return;
  }

  if (action === 'ul') {
    prefixSelectedLines(textarea, (line) => {
      if (line.startsWith('- ')) return line;
      return `- ${line}`;
    }, onUpdate);
    return;
  }

  if (action === 'ol') {
    prefixSelectedLines(textarea, (line, idx) => {
      const clean = line.replace(/^\d+\.\s+/, '');
      return `${idx + 1}. ${clean}`;
    }, onUpdate);
    return;
  }

  if (action === 'link') {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const selected = textarea.value.slice(start, end).trim();
    const text = selected || 'link text';
    const url = window.prompt('Enter URL (https://... or /path):', 'https://');
    if (!url) return;
    const markdown = `[${text}](${url.trim()})`;
    textarea.setRangeText(markdown, start, end, 'end');
    textarea.focus();
    if (onUpdate) onUpdate();
  }
}

function initNewsEditor() {
  const form = $('news-post-form');
  const contentEl = $('news-post-content');
  const uploadBtn = $('news-post-upload-btn');
  const fileInput = $('news-post-image-file');

  if (!form || !contentEl || !uploadBtn || !fileInput) return;

  form.querySelectorAll('[data-md-action]').forEach(btn => {
    btn.addEventListener('click', () => handleMarkdownAction(btn.getAttribute('data-md-action'), 'news-post-content', updateNewsPreview));
  });

  contentEl.addEventListener('input', updateNewsPreview);

  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];

    setUploadStatus('news-post-upload-status', 'Uploading image...');
    try {
      await uploadImage(file, 'news-post-content', updateNewsPreview);
      setUploadStatus('news-post-upload-status', 'Image uploaded and inserted into content.');
    } catch (err) {
      setUploadStatus('news-post-upload-status', err.message || 'Upload failed.', true);
    } finally {
      fileInput.value = '';
    }
  });

  updateNewsPreview();
}

function initAnnouncementEditor() {
  const form = $('announcement-form');
  const contentEl = $('announcement-content');
  const uploadBtn = $('announcement-upload-btn');
  const fileInput = $('announcement-image-file');

  if (!form || !contentEl || !uploadBtn || !fileInput) return;

  form.querySelectorAll('[data-md-action]').forEach(btn => {
    btn.addEventListener('click', () => handleMarkdownAction(btn.getAttribute('data-md-action'), 'announcement-content', updateAnnouncementPreview));
  });

  contentEl.addEventListener('input', updateAnnouncementPreview);

  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];

    setUploadStatus('announcement-upload-status', 'Uploading image...');
    try {
      await uploadImage(file, 'announcement-content', updateAnnouncementPreview);
      setUploadStatus('announcement-upload-status', 'Image uploaded and inserted into content.');
    } catch (err) {
      setUploadStatus('announcement-upload-status', err.message || 'Upload failed.', true);
    } finally {
      fileInput.value = '';
    }
  });

  updateAnnouncementPreview();
}

// -- Product Inventory --
async function loadInventory() {
  const container = $('inventory-list');
  container.innerHTML = '<p style="color:var(--text-secondary)">Loading...</p>';

  try {
    const res = await authFetch(`${API_BASE}/api/admin/inventory`);
    const data = await res.json();
    const products = data.products || [];
    inventoryCache = products;

    if (products.length === 0) {
      container.innerHTML = `
        <p style="color:var(--text-secondary)">
          No inventory configured yet.
          <button class="btn btn--sm btn--outline" style="margin-left:var(--space-4)" id="init-inventory-inline-btn">Initialize from Menu</button>
        </p>
      `;
      const initBtn = $('init-inventory-inline-btn');
      if (initBtn) initBtn.addEventListener('click', initInventory);
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Weekly Qty</th>
            <th>Current Qty</th>
            <th>Available</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${products.map(p => `
            <tr data-inv-sku="${p.sku}">
              <td>${p.name}</td>
              <td>${p.sku}</td>
              <td><input type="number" min="0" value="${p.weeklyQty}" data-field="weeklyQty" style="width:80px;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;font-size:var(--text-sm)"></td>
              <td><input type="number" min="0" value="${p.currentQty}" data-field="currentQty" style="width:80px;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;font-size:var(--text-sm)"></td>
              <td><input type="checkbox" ${p.available ? 'checked' : ''} data-field="available"></td>
              <td><button class="btn btn--sm btn--primary" onclick="saveInventoryItem('${p.sku}')">Save</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    container.innerHTML = `<p class="form-error">${e.message}</p>`;
  }
}

window.saveInventoryItem = async function(sku) {
  const row = document.querySelector(`tr[data-inv-sku="${sku}"]`);
  if (!row) return;

  const weeklyInput = row.querySelector('[data-field="weeklyQty"]');
  const currentInput = row.querySelector('[data-field="currentQty"]');
  const availableInput = row.querySelector('[data-field="available"]');
  const errorEl = $('inventory-error');
  errorEl.classList.add('hidden');

  const payload = {
    weeklyQty: parseInt(weeklyInput.value, 10),
    currentQty: parseInt(currentInput.value, 10),
    available: availableInput.checked,
  };

  if (isNaN(payload.weeklyQty) || payload.weeklyQty < 0) {
    showError(errorEl, 'Weekly quantity must be a non-negative number.');
    return;
  }
  if (isNaN(payload.currentQty) || payload.currentQty < 0) {
    showError(errorEl, 'Current quantity must be a non-negative number.');
    return;
  }

  try {
    const res = await authFetch(`${API_BASE}/api/admin/inventory/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Failed to update inventory.');
    }

    loadInventory();
  } catch (e) {
    showError(errorEl, e.message);
  }
};

async function resetInventory() {
  if (!confirm('Reset all products to their weekly default quantities? This will overwrite current quantities.')) {
    return;
  }

  const errorEl = $('inventory-error');
  errorEl.classList.add('hidden');

  try {
    const res = await authFetch(`${API_BASE}/api/admin/inventory/reset`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Failed to reset inventory.');
    }

    const data = await res.json();
    alert(data.message || 'Inventory reset successfully.');
    loadInventory();
  } catch (e) {
    showError(errorEl, e.message);
  }
}

async function initInventory() {
  if (!confirm('Initialize inventory from menu? This creates entries for all products with 0 quantities. You can then set weekly quantities.')) {
    return;
  }

  const errorEl = $('inventory-error');
  errorEl.classList.add('hidden');

  try {
    const res = await authFetch(`${API_BASE}/api/admin/inventory`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Failed to initialize inventory.');
    }

    loadInventory();
  } catch (e) {
    showError(errorEl, e.message);
  }
}

// -- Init --
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

  // Inventory reset button
  $('reset-inventory-btn').addEventListener('click', resetInventory);

  initNewsEditor();
  initAnnouncementEditor();
}
