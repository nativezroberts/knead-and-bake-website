/**
 * Admin Page - login, skip date management, announcement management, news post management,
 * product inventory, and weekly preorder summaries.
 */

import { renderMarkdown } from './markdown.js';

const API_BASE = window.__API_BASE || '';
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SUMMARY_EMAIL = 'allyson.m.roberts@gmail.com';

let authToken = null;
let editingAnnouncementId = null;
let editingNewsPostId = null;
let announcementsCache = [];
let newsPostsCache = [];
let inventoryCache = [];
let preordersReady = false;
let preorderSummaryCache = null;

// -- Tabs --
const TAB_KEYS = ['skipDates', 'announcements', 'news', 'inventory', 'preorders'];
const TAB_STORAGE_KEY = 'admin_active_tab';
const loadedTabs = new Set();
let isDirty = false;

function markDirty() { isDirty = true; }
function clearDirty() { isDirty = false; }

function confirmIfDirty() {
  if (!isDirty) return true;
  return confirm('You have unsaved changes. Switch tabs anyway?');
}

function getInitialTab() {
  const params = new URLSearchParams(window.location.search);
  const urlTab = params.get('tab');
  if (urlTab && TAB_KEYS.includes(urlTab)) return urlTab;
  const stored = localStorage.getItem(TAB_STORAGE_KEY);
  if (stored && TAB_KEYS.includes(stored)) return stored;
  return TAB_KEYS[0];
}

function activateTab(key, pushState = true) {
  if (!TAB_KEYS.includes(key)) return;
  if (!confirmIfDirty()) {
    // Revert select to whichever tab is still active
    const mobileNav = document.getElementById('admin-mobile-nav');
    if (mobileNav) {
      const currentKey = TAB_KEYS.find(k => $(`tab-${k}`)?.getAttribute('aria-selected') === 'true');
      if (currentKey) mobileNav.value = currentKey;
    }
    return;
  }
  clearDirty();

  TAB_KEYS.forEach(k => {
    const tab = $(`tab-${k}`);
    const panel = $(`panel-${k}`);
    const selected = k === key;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.classList.toggle('hidden', !selected);
  });

  // Sync mobile select
  const mobileNav = document.getElementById('admin-mobile-nav');
  if (mobileNav) mobileNav.value = key;

  if (pushState) {
    const url = new URL(window.location);
    url.searchParams.set('tab', key);
    history.replaceState(null, '', url);
  }
  localStorage.setItem(TAB_STORAGE_KEY, key);

  if (!loadedTabs.has(key)) {
    loadedTabs.add(key);
    loadTabData(key);
  }
}

function loadTabData(key) {
  switch (key) {
    case 'skipDates': loadSkipDates(); break;
    case 'announcements': loadAnnouncements(); break;
    case 'news': loadNewsPosts(); break;
    case 'inventory': loadInventory(); break;
    case 'preorders': loadPreorderSummary(); break;
  }
}

function initTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return;

  tablist.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    const key = tab.id.replace('tab-', '');
    activateTab(key);
    tab.focus();
  });

  tablist.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    const idx = TAB_KEYS.indexOf(tab.id.replace('tab-', ''));
    let newIdx = idx;

    if (e.key === 'ArrowRight') newIdx = (idx + 1) % TAB_KEYS.length;
    else if (e.key === 'ArrowLeft') newIdx = (idx - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    else if (e.key === 'Home') newIdx = 0;
    else if (e.key === 'End') newIdx = TAB_KEYS.length - 1;
    else return;

    e.preventDefault();
    const newTab = $(`tab-${TAB_KEYS[newIdx]}`);
    newTab.focus();
  });

  // Enter/Space activate focused tab
  tablist.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const tab = e.target.closest('[role="tab"]');
      if (!tab) return;
      e.preventDefault();
      const key = tab.id.replace('tab-', '');
      activateTab(key);
    }
  });

  // Mobile select nav
  const mobileNav = document.getElementById('admin-mobile-nav');
  if (mobileNav) {
    mobileNav.addEventListener('change', (e) => { activateTab(e.target.value); });
  }

  // Dirty guard on page unload
  window.addEventListener('beforeunload', (e) => {
    if (isDirty) { e.preventDefault(); }
  });
}

// -- Toast --
function showToast(msg, type = 'success', duration = 2500) {
  let el = document.getElementById('admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast--${type}`;
  requestAnimationFrame(() => { el.classList.add('is-visible'); });
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.classList.remove('is-visible'); }, duration);
}

// -- Low-stock badge --
function updateInventoryBadge() {
  const tab = $('tab-inventory');
  if (!tab) return;
  let badge = tab.querySelector('.tab-badge');
  const lowCount = inventoryCache.filter(p => p.available && p.currentQty <= 3).length;
  if (lowCount > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.setAttribute('aria-label', 'low stock items');
      tab.appendChild(badge);
    }
    badge.textContent = lowCount;
  } else if (badge) {
    badge.remove();
  }
}

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
  const initial = getInitialTab();
  activateTab(initial, true);
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    clearDirty();
    showToast('Skip date added');
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

    clearDirty();
    showToast(isEditing ? 'Announcement updated' : 'Announcement added');
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

    clearDirty();
    showToast(isEditing ? 'Post updated' : 'Post added');
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

// -- Weekly Preorders --
function toYMD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseYMD(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return null;
  const parsed = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getWeekStartSunday(date = new Date()) {
  const start = new Date(date);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatWeekRange(startDate, endDate) {
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startLabel = startDate.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
  const endLabel = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

function buildWeekOptions(currentWeekStart) {
  return [
    { offset: -1, label: 'Last week' },
    { offset: 0, label: 'Current Week' },
    { offset: 1, label: 'Next week' },
  ].map(({ offset, label }) => ({
    value: toYMD(addDays(currentWeekStart, offset * 7)),
    label,
  }));
}

function setPreordersError(message = '') {
  const errorEl = $('preorders-error');
  if (!errorEl) return;
  if (!message) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    return;
  }
  showError(errorEl, message);
}

function setPreordersLoading(isLoading) {
  const loadingEl = $('preorders-loading');
  if (!loadingEl) return;
  loadingEl.classList.toggle('hidden', !isLoading);
}

function renderPreorderAnalytics(summary) {
  const container = $('preorders-analytics');
  if (!container) return;
  const totals = summary?.totals || {};
  const cards = [
    { label: 'Orders', value: totals.orderCount ?? 0 },
    { label: 'Total Qty', value: totals.totalQty ?? 0 },
    { label: 'Customers', value: totals.uniqueCustomers ?? 0 },
    { label: 'Product Types', value: totals.productTypeCount ?? 0 },
  ];
  container.innerHTML = cards.map(card => `
    <div class="preorders-card">
      <div class="preorders-card__label">${escapeHtml(card.label)}</div>
      <div class="preorders-card__value">${Number(card.value).toLocaleString('en-US')}</div>
    </div>
  `).join('');
}

function renderPreorderProductTotals(summary) {
  const container = $('preorders-product-totals');
  if (!container) return;
  const rows = summary?.productTotals || [];

  if (rows.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary)">No preorders for this week.</p>';
    return;
  }

  container.innerHTML = `
    <ul class="preorders-items">
      ${rows.map(row => `
        <li>
          <span>${escapeHtml(row.name)}</span>
          <strong>${Number(row.qty || 0).toLocaleString('en-US')}</strong>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderPreorderOrders(summary) {
  const container = $('preorders-orders');
  if (!container) return;
  const orders = summary?.orders || [];

  if (orders.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary)">No customer orders for this week.</p>';
    return;
  }

  container.innerHTML = `
    <div class="preorders-orders-table-wrap">
      <table class="admin-table preorders-orders-table">
        <colgroup>
          <col class="preorders-orders-col--customer">
          <col class="preorders-orders-col--contact">
          <col class="preorders-orders-col--items">
          <col class="preorders-orders-col--pickup">
          <col class="preorders-orders-col--notes">
          <col class="preorders-orders-col--actions">
        </colgroup>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Contact</th>
            <th>Items</th>
            <th>Pickup</th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(order => `
            <tr>
              <td class="preorders-orders-cell--customer" data-label="Customer">
                <strong>${escapeHtml(order.name || '-')}</strong><br>
                <span class="preorders-meta">Placed ${escapeHtml(formatDateTime(order.createdAt))}</span>
              </td>
              <td class="preorders-orders-cell--contact" data-label="Contact">
                <div>${escapeHtml(order.phone || '-')}</div>
                <div class="preorders-meta">${escapeHtml(order.email || 'No email')}</div>
              </td>
              <td class="preorders-orders-cell--items" data-label="Items">
                ${(Array.isArray(order.items) && order.items.length > 0)
                  ? `<div class="preorders-line-items">${order.items.map(item => `
                    <div class="preorders-line-item">
                      <strong>${Number(item.qty || 0)}x</strong> ${escapeHtml(item.name || '')}
                    </div>
                  `).join('')}</div>`
                  : '-'}
              </td>
              <td class="preorders-orders-cell--pickup" data-label="Pickup">${escapeHtml(order.pickupDate || '-')}</td>
              <td class="preorders-orders-cell--notes" data-label="Notes">${order.notes ? escapeHtml(order.notes) : '<span class="preorders-meta">None</span>'}</td>
              <td class="preorders-orders-cell--actions" data-label="Actions">
                <button class="btn ${order.paid ? 'btn--paid' : 'btn--mark-paid'}" data-order-id="${escapeHtml(order.orderId || '')}" data-paid="${order.paid ? 'true' : 'false'}">${order.paid ? 'Paid' : 'Mark Paid'}</button>
                <button class="btn btn--reject" data-order-id="${escapeHtml(order.orderId || '')}" data-order-name="${escapeHtml(order.name || 'this customer')}">Reject</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Attach payment toggle handlers
  container.querySelectorAll('.btn--mark-paid, .btn--paid').forEach(btn => {
    btn.addEventListener('click', () => handleTogglePayment(btn));
  });

  // Attach reject button handlers
  container.querySelectorAll('.btn--reject').forEach(btn => {
    btn.addEventListener('click', () => handleRejectOrder(btn));
  });
}

async function handleTogglePayment(btn) {
  const orderId = btn.dataset.orderId;
  if (!orderId) return;

  const currentlyPaid = btn.dataset.paid === 'true';
  const newPaid = !currentlyPaid;

  const originalText = btn.textContent;
  btn.textContent = 'Updating...';
  btn.disabled = true;

  try {
    const res = await authFetch(`${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid: newPaid }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Failed to update payment status.');
    }
    // Update button state
    btn.dataset.paid = newPaid ? 'true' : 'false';
    btn.textContent = newPaid ? 'Paid' : 'Mark Paid';
    btn.className = `btn ${newPaid ? 'btn--paid' : 'btn--mark-paid'}`;
    btn.disabled = false;
    showToast(data.message || 'Payment status updated.');
  } catch (e) {
    setPreordersError(e.message || 'Failed to update payment status.');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function handleRejectOrder(btn) {
  const orderId = btn.dataset.orderId;
  const customerName = btn.dataset.orderName;
  if (!orderId) return;

  const confirmed = confirm(`Are you sure you want to reject ${customerName}'s order?\n\nThis will cancel the order, restore inventory, and notify the customer.`);
  if (!confirmed) return;

  const reason = prompt('Enter a reason for rejecting this order (optional):');
  // If user clicks Cancel on the prompt, abort the rejection
  if (reason === null) return;

  const originalText = btn.textContent;
  btn.textContent = 'Rejecting...';
  btn.disabled = true;

  try {
    const res = await authFetch(`${API_BASE}/api/admin/orders/${encodeURIComponent(orderId)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Failed to reject order.');
    }
    showToast(data.message || 'Order rejected successfully.');
    // Reload the summary to reflect updated totals and remove the cancelled order
    const weekSelect = $('preorders-week-select');
    if (weekSelect) {
      loadPreorderSummary(weekSelect.value);
    }
  } catch (e) {
    setPreordersError(e.message || 'Failed to reject order.');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function renderPreorderSummary(summary) {
  preorderSummaryCache = summary;
  const summaryEl = $('preorders-summary');
  const weekLabelEl = $('preorders-week-label');
  if (!summaryEl || !weekLabelEl) return;

  const start = parseYMD(summary?.weekStart || '');
  const end = parseYMD(summary?.weekEnd || '');
  const weekLabel = (start && end)
    ? formatWeekRange(start, end)
    : `${summary?.weekStart || ''} - ${summary?.weekEnd || ''}`;
  weekLabelEl.textContent = `Preorders for ${weekLabel} (Generated ${formatDateTime(summary?.generatedAt)})`;

  renderPreorderAnalytics(summary);
  renderPreorderProductTotals(summary);
  renderPreorderOrders(summary);
  summaryEl.classList.remove('hidden');
}

function initPreordersTab() {
  if (preordersReady) return;

  const weekSelect = $('preorders-week-select');
  const refreshBtn = $('preorders-refresh-btn');
  const printBtn = $('preorders-print-btn');
  const emailBtn = $('preorders-email-btn');
  const emailInput = $('preorders-email-input');

  if (!weekSelect || !refreshBtn || !printBtn || !emailBtn || !emailInput) return;

  const currentWeekStart = getWeekStartSunday(new Date());
  const options = buildWeekOptions(currentWeekStart);
  weekSelect.innerHTML = options
    .map(opt => `<option value="${opt.value}">${escapeHtml(opt.label)}</option>`)
    .join('');
  weekSelect.value = toYMD(currentWeekStart);

  if (!emailInput.value.trim()) {
    emailInput.value = DEFAULT_SUMMARY_EMAIL;
  }

  weekSelect.addEventListener('change', () => {
    loadPreorderSummary(weekSelect.value);
  });
  refreshBtn.addEventListener('click', () => {
    loadPreorderSummary(weekSelect.value);
  });
  printBtn.addEventListener('click', () => {
    window.print();
  });
  emailBtn.addEventListener('click', sendPreorderSummaryEmail);

  preordersReady = true;
}

async function loadPreorderSummary(weekStartOverride = '') {
  initPreordersTab();
  const weekSelect = $('preorders-week-select');
  const summaryEl = $('preorders-summary');
  if (!weekSelect || !summaryEl) return;

  const weekStart = weekStartOverride || weekSelect.value || toYMD(getWeekStartSunday(new Date()));
  if (weekSelect.value !== weekStart) {
    weekSelect.value = weekStart;
  }

  setPreordersError('');
  setPreordersLoading(true);
  summaryEl.classList.add('hidden');

  try {
    const res = await authFetch(`${API_BASE}/api/admin/preorders/summary?weekStart=${encodeURIComponent(weekStart)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Failed to load preorder summary.');
    }
    renderPreorderSummary(data.summary || {
      weekStart,
      weekEnd: toYMD(addDays(parseYMD(weekStart) || getWeekStartSunday(new Date()), 6)),
      generatedAt: new Date().toISOString(),
      totals: { orderCount: 0, totalQty: 0, uniqueCustomers: 0, productTypeCount: 0 },
      productTotals: [],
      orders: [],
    });
  } catch (e) {
    setPreordersError(e.message || 'Failed to load preorder summary.');
  } finally {
    setPreordersLoading(false);
  }
}

async function sendPreorderSummaryEmail() {
  const emailInput = $('preorders-email-input');
  const emailBtn = $('preorders-email-btn');
  const weekSelect = $('preorders-week-select');
  if (!emailInput || !emailBtn || !weekSelect) return;

  const toEmail = emailInput.value.trim();
  if (toEmail && !EMAIL_REGEX.test(toEmail)) {
    setPreordersError('Please enter a valid email address.');
    return;
  }

  setPreordersError('');
  const originalText = emailBtn.textContent;
  emailBtn.textContent = 'Sending...';
  emailBtn.disabled = true;

  try {
    const res = await authFetch(`${API_BASE}/api/admin/preorders/email-summary`, {
      method: 'POST',
      body: JSON.stringify({
        weekStart: weekSelect.value,
        toEmail,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Failed to send summary email.');
    }
    showToast(data.message || `Summary emailed to ${toEmail || DEFAULT_SUMMARY_EMAIL}`);
  } catch (e) {
    setPreordersError(e.message || 'Failed to send summary email.');
  } finally {
    emailBtn.textContent = originalText;
    emailBtn.disabled = false;
  }
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
    updateInventoryBadge();
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

    showToast('Inventory saved');
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
  initTabs();

  // Dirty tracking on all admin form inputs
  document.querySelectorAll('#admin-content input:not([data-no-dirty]), #admin-content textarea:not([data-no-dirty]), #admin-content select:not([data-no-dirty])').forEach(el => {
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });
}
