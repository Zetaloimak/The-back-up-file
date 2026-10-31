/* =========================================================
   index.js — landing page only
   - login and sign-up popup (calls /api/login and /api/signup)
   - Google reCAPTCHA on the sign-up form
   - Start button (goes to the download page when logged in)
   - See more button (goes to the product page, log in first if needed)
   - navbar highlight while scrolling
   ========================================================= */
(() => {
  'use strict';

  const PTS = window.PTS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const isLoggedIn = () => Boolean(document.body.dataset.user);

  const auth = $('#auth');
  const msgEl = $('#authMsg');
  const loginForm = $('#loginForm');
  const signinForm = $('#signinForm');
  const captchaBox = $('#recaptchaBox');
  let lastFocus = null;
  let captchaId = null;
  let captchaReady = false;
  let nextPage = null;

  function setMsg(text, type = '') {
    msgEl.textContent = text;
    msgEl.className = `auth-msg ${type}`.trim();
  }
  function renderCaptcha() {
    if (!captchaReady || captchaId !== null || signinForm.hidden) return;
    captchaId = grecaptcha.render(captchaBox, {
      sitekey: captchaBox.dataset.sitekey,
      theme: 'light'
    });
  }
  window.onRecaptchaLoad = () => {
    captchaReady = true;
    renderCaptcha();
  };

  /* ---------- popup ---------- */
  function setMode(mode) {
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
    loginForm.hidden = mode !== 'login';
    signinForm.hidden = mode !== 'signin';
    setMsg('');
    renderCaptcha();
  }

  // next = the page to open after a successful log in (optional)
  function openAuth(mode = 'login', next = null) {
    nextPage = next;
    lastFocus = document.activeElement;
    auth.classList.add('open');
    document.body.classList.add('locked');
    setMode(mode);
    setTimeout(() => $('form:not([hidden]) input', auth)?.focus(), 60);
  }

  function closeAuth() {
    nextPage = null;
    auth.classList.remove('open');
    document.body.classList.remove('locked');
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  PTS.openLogin = openAuth; // used by the navbar button in common.js

  $$('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
  $('#authClose').addEventListener('click', closeAuth);
  auth.addEventListener('click', e => { if (e.target === auth) closeAuth(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && auth.classList.contains('open')) closeAuth();
  });

  // keep keyboard focus inside the popup while it is open
  auth.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = $$('button, input, a[href]', auth).filter(el => el.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- Log in ---------- */
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('#loginUser').value.trim();
    const password = $('#loginPass').value;
    if (!username || !password) return setMsg('Please enter your username and password.', 'error');

    const r = await PTS.api('/api/login', { username, password });
    if (!r.ok) return setMsg(r.message || 'Log in failed.', 'error');

    setMsg(`Welcome back, ${r.user}!`, 'success');
    setTimeout(() => {
      if (nextPage) location.href = nextPage; // go to the page the user asked for, such as the product page
      else location.reload();                 // refresh so the navbar shows the username
    }, 600);
  });

  /* ---------- Sign in (create account) ---------- */
  signinForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (captchaId === null) return setMsg('Security check is still loading. Try again in a moment.', 'error');

    const captcha = grecaptcha.getResponse(captchaId);
    if (!captcha) return setMsg('Please tick "I\'m not a robot" first.', 'error');

    const username = $('#signUser').value.trim();
    const password = $('#signPass').value;
    const r = await PTS.api('/api/signup', { username, password, captcha });
    grecaptcha.reset(captchaId); // each captcha answer can be used only once

    if (!r.ok) return setMsg(r.message || 'Sign up failed.', 'error');

    e.target.reset();
    setMode('login');
    $('#loginUser').value = username;
    setMsg(r.message, 'success');
  });

  $('#forgotLink').addEventListener('click', e => {
    e.preventDefault();
    setMsg('Password reset is not set up yet. Please contact us.');
  });

  // opened from another page with ?login=1, optionally with &next=/product
  const params = new URLSearchParams(location.search);
  if (params.get('login') === '1') {
    // only allow a path on this site (such as /product), never another website
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
    history.replaceState(null, '', location.pathname + location.hash);
    openAuth('login', safeNext);
  }

  /* ---------- Start button ----------
     Logged in: go to the download page. Logged out: open the log in popup. */
  $('#openAuth').addEventListener('click', () => {
    if (isLoggedIn()) location.href = '/download';
    else openAuth('login');
  });

  /* ---------- See more button ----------
     Logged in: go to the product page.
     Logged out: open the log in popup, then go to the product page after log in. */
  const seeMore = $('#seeMore');
  if (seeMore) {
    seeMore.addEventListener('click', e => {
      e.preventDefault();
      const productUrl = seeMore.getAttribute('href');
      if (isLoggedIn()) location.href = productUrl;
      else openAuth('login', productUrl);
    });
  }

  /* ---------- navbar highlight for the section in view ---------- */
  const navLinks = $$('#navLinks a');
  const sectionIO = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href').endsWith(`#${en.target.id}`)));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['top', 'About', 'How', 'Contact', 'Team'].forEach(id => sectionIO.observe(document.getElementById(id)));
})();