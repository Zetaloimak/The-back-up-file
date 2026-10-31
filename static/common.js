/* =========================================================
   common.js — loaded on every page
   - PTS.api()  : sends requests to the Flask server (/api/...)
   - navbar     : scroll progress, mobile menu, Log in / Log out
   - toast, clipboard copy, phone copy, scroll reveal, footer year
   ========================================================= */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const isLoggedIn = () => Boolean(document.body.dataset.user);

  /* ---------- call the server ---------- */
  async function api(path, data = {}) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const json = await res.json().catch(() => ({}));
      return { ...json, ok: res.ok && json.ok === true, status: res.status };
    } catch {
      return { ok: false, message: 'Could not reach the server. Try again.' };
    }
  }

  /* ---------- toast ---------- */
  let toastEl = null;
  let toastTimer = null;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ---------- clipboard with fallback ---------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  }

  /* ---------- public API (used by index.js) ---------- */
  window.PTS = { api, toast, copy: copyText, openLogin: null };

  /* ---------- navbar: scroll progress + shadow ---------- */
  const topbar = $('#topbar');
  const progress = $('.progress');
  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    topbar.classList.toggle('scrolled', scrollY > 40);
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  /* ---------- navbar: mobile menu ---------- */
  const menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', () => {
    const open = topbar.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  $$('#navLinks a').forEach(a => a.addEventListener('click', () => {
    topbar.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }));

  /* ---------- navbar: Log in / Log out ---------- */
  $('#navLogin').addEventListener('click', async () => {
    if (isLoggedIn()) {
      await api('/api/logout');
      location.href = '/';
    } else if (PTS.openLogin) {
      PTS.openLogin();
    } else {
      location.href = '/?login=1';
    }
  });

  /* ---------- links that need a log in first (such as Product) ---------- */
  $$('[data-login-required]').forEach(a => a.addEventListener('click', e => {
    if (isLoggedIn()) return; // logged in: open the page as normal
    e.preventDefault();
    const target = a.getAttribute('href');
    if (PTS.openLogin) PTS.openLogin('login', target); // home page: open the log in popup here
    else location.href = `/?login=1&next=${encodeURIComponent(target)}`; // other pages: go home and open it
  }));

  /* ---------- copy phone number ---------- */
  $$('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
    const ok = await copyText(btn.dataset.copy);
    toast(ok ? 'Number copied' : 'Could not copy the number');
  }));

  /* ---------- scroll reveal ---------- */
  const revealIO = new IntersectionObserver((entries, obs) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('in');
        obs.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  $$('.reveal').forEach(el => revealIO.observe(el));

  /* ---------- footer year ---------- */
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
})();