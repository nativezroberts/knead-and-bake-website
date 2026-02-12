/**
 * Navigation — sticky header scroll effect + mobile menu toggle.
 */

export function initNav() {
  const header = document.querySelector('.header');
  const menuBtn = document.querySelector('.header__menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');
  const closeBtn = document.querySelector('.mobile-nav__close');
  const backdrop = document.querySelector('.mobile-nav__backdrop');

  // Sticky shadow on scroll
  if (header) {
    const onScroll = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Mobile menu open/close
  function openMenu() {
    if (!mobileNav) return;
    mobileNav.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    closeBtn?.focus();
  }

  function closeMenu() {
    if (!mobileNav) return;
    mobileNav.classList.remove('is-open');
    document.body.style.overflow = '';
    menuBtn?.focus();
  }

  menuBtn?.addEventListener('click', openMenu);
  closeBtn?.addEventListener('click', closeMenu);
  backdrop?.addEventListener('click', closeMenu);

  // Close drawer when a mobile nav link is selected.
  document.querySelectorAll('.mobile-nav__link, .mobile-nav__cta').forEach((link) => {
    link.addEventListener('click', () => {
      if (mobileNav?.classList.contains('is-open')) {
        closeMenu();
      }
    });
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileNav?.classList.contains('is-open')) {
      closeMenu();
    }
  });

  // Mark active nav link
  const normalizePath = (path) => {
    if (!path) return '/';
    return path === '/index.html' ? '/' : path;
  };
  const currentPath = normalizePath(window.location.pathname);
  document.querySelectorAll('.nav__link, .mobile-nav__link').forEach(link => {
    const href = normalizePath(link.getAttribute('href'));
    if (href === currentPath || (href !== '/' && currentPath.startsWith(href))) {
      link.classList.add('is-active');
    }
  });
}
