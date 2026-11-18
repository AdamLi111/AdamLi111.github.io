/* Haocheng Li — site interactions
 *
 * 1. Highlights reel: the rolling demos beside the intro. Every slide paints a
 *    small WebP poster first; the active slide is upgraded to its GIF once the
 *    page has finished loading, and the next slide's GIF is warmed in the
 *    background. Clicking a clip scrolls to its row further down.
 * 2. Projects, work and research are rows on this one page. A row's GIF only
 *    downloads once it comes near the viewport. With reduced motion or
 *    Save-Data, GIFs become click-to-play.
 * 3. Clicking a thumbnail or figure shows it enlarged.
 * 4. The top bar marks the section being read.
 * 5. Rows open on a plain-language summary; a "Technical details" button
 *    cross-fades to the in-depth version and shows the row's other figures
 *    under its thumbnail.
 * 6. English / 中文: every string is in the page in both languages and a class
 *    on <html> shows one. The choice is remembered; ?lang=zh links to Chinese.
 */
(() => {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Only explicit visitor preferences switch GIFs off (effectiveType starts out
  // pessimistic in Chrome, so it is not a reliable signal here).
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const reduced = () => mqReduce.matches;
  const lite = () => reduced() || saveData;
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const bar = doc.querySelector('.topbar');
  const barBottom = () => (bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0);
  // Scroll corrections must be instant, whatever the CSS smooth scrolling says.
  const nudge = (dy) => window.scrollTo({ top: window.scrollY + dy, behavior: 'instant' });

  let gifsReady = false; // GIFs wait until the page has loaded

  const syncLite = () => root.classList.toggle('lite', lite());
  syncLite();

  /* ------------------------------------------------------------------ GIFs */
  const loads = new Map();
  function preload(url) {
    let p = loads.get(url);
    if (!p) {
      p = new Promise((resolve, reject) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => resolve(url);
        im.onerror = () => { loads.delete(url); reject(new Error('Could not load ' + url)); };
        im.src = url;
      });
      loads.set(url, p);
    }
    return p;
  }

  // Swap a poster for its GIF once the GIF is fully downloaded (no half-drawn frames).
  function play(img) {
    const url = img && img.dataset.gif;
    if (!url || img.dataset.state) return;
    img.dataset.state = 'loading';
    preload(url).then(() => {
      img.src = url;
      img.dataset.state = 'playing';
      const fig = img.closest('.media, .slide, .entry-thumb');
      if (fig) fig.classList.add('is-playing');
    }, () => { delete img.dataset.state; });
  }

  const eager = (scope) => scope.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = 'eager'; });

  /* ----------------------------------------------------------------- reel */
  class Reel {
    constructor(el, index) {
      this.el = el;
      this.track = el.querySelector('.reel-track');
      this.slides = Array.from(this.track.children);
      this.n = this.slides.length;
      this.i = 0;
      this.anim = null; // progress-bar animation of the active slide; its end advances the reel
      this.visible = false;
      this.held = 0; // bit 1: pointer over the reel, bit 2: keyboard focus inside
      this.stagger = 600 + index * 1400; // so several reels never move in unison
      this.dwell = 4600;
      if (this.n < 2) return;

      // A copy of the first slide at the end makes the loop seamless.
      const clone = this.slides[0].cloneNode(true);
      clone.classList.add('is-clone');
      clone.setAttribute('aria-hidden', 'true');
      this.track.appendChild(clone);
      this.cloneImg = clone.querySelector('.slide-img');

      const progress = doc.createElement('div');
      progress.className = 'reel-progress';
      this.fills = this.slides.map((slide, k) => {
        const b = doc.createElement('button');
        const cap = slide.querySelector('figcaption');
        b.type = 'button';
        // The label is visually hidden text (not aria-label), so it follows the
        // page language the same way the captions do.
        b.innerHTML = '<span class="sr-only"><span class="en">Show </span><span class="zh">查看：</span>'
          + (cap ? cap.innerHTML : String(k + 1)) + '</span><span class="t"><span class="f"></span></span>';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.go(k);
        });
        progress.appendChild(b);
        return b.querySelector('.f');
      });
      // one tab stop per reel; arrow keys move between slides (focus also pauses it)
      progress.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const k = (this.i % this.n + step + this.n) % this.n;
        this.go(k);
        this.fills[k].parentNode.parentNode.focus();
      });
      el.appendChild(progress);
      this.paint();

      this.track.addEventListener('transitionend', (e) => {
        if (e.target === this.track && e.propertyName === 'transform' && this.i >= this.n) this.snap(this.i - this.n);
      });
      el.addEventListener('pointerenter', () => this.hold(1, true));
      el.addEventListener('pointerleave', () => this.hold(1, false));
      el.addEventListener('focusin', () => this.hold(2, true));
      el.addEventListener('focusout', () => this.hold(2, false));
    }

    hold(bit, on) {
      this.held = on ? this.held | bit : this.held & ~bit;
      this.schedule();
    }

    setVisible(v) {
      this.visible = v;
      if (v) this.activate();
      if (v && !this.anim) this.startSlide();
      else this.schedule();
    }

    canRun() {
      return this.n > 1 && this.visible && !this.held && !doc.hidden && !reduced() && !lightbox.open;
    }

    // Pause or resume the active slide's countdown.
    schedule() {
      if (!this.anim) return;
      if (this.canRun()) this.anim.play();
      else this.anim.pause();
    }

    startSlide() {
      if (this.n < 2) return;
      this.fills.forEach((f) => f.getAnimations().forEach((a) => a.cancel()));
      this.anim = null;
      if (reduced()) return; // no auto-advance; paint() marks the active segment
      const anim = this.fills[this.i % this.n].animate(
        [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: this.dwell + this.stagger, easing: 'linear', fill: 'forwards' }
      );
      this.stagger = 0;
      this.anim = anim;
      anim.finished.then(() => {
        if (this.anim === anim) this.go(this.i + 1);
      }, () => {});
      this.schedule();
    }

    go(k) {
      if (this.i >= this.n) this.snap(this.i - this.n); // a wrap-around was interrupted
      this.i = k;
      this.track.style.transform = 'translate3d(' + -100 * k + '%,0,0)';
      this.paint();
      this.activate();
      this.startSlide();
    }

    snap(k) {
      const t = this.track;
      t.style.transition = 'none';
      this.i = k;
      t.style.transform = 'translate3d(' + -100 * k + '%,0,0)';
      void t.offsetWidth; // commit the jump before transitions come back
      t.style.transition = '';
    }

    paint() {
      if (!this.fills) return;
      const a = this.i % this.n;
      this.el.classList.toggle('is-paper', this.slides[a].classList.contains('slide--paper'));
      this.fills.forEach((f, k) => {
        const b = f.parentNode.parentNode;
        b.setAttribute('aria-current', String(k === a));
        b.tabIndex = k === a ? 0 : -1;
        f.style.transform = k < a || (k === a && reduced()) ? 'scaleX(1)' : 'scaleX(0)';
      });
    }

    activate() {
      if (this.n < 2) return;
      const next = this.slides[(this.i + 1) % this.n];
      eager(next); // its poster must be ready before it slides in
      if (!this.visible || !gifsReady || lite()) return;
      play(this.slides[this.i % this.n].querySelector('.slide-img'));
      if (this.i >= this.n - 1) play(this.cloneImg); // the clone stands in for slide 0
      const nextImg = next.querySelector('.slide-img');
      if (nextImg && nextImg.dataset.gif) preload(nextImg.dataset.gif).catch(() => {});
    }
  }

  // The lightbox exists before the reels so they can pause while it is open.
  const lightbox = doc.createElement('dialog');

  const reels = Array.from(doc.querySelectorAll('[data-reel]'), (el, k) => new Reel(el, k));
  const refreshReels = () => reels.forEach((r) => r.schedule());

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const reel = reels.find((r) => r.el === en.target);
        if (reel) reel.setVisible(en.isIntersecting);
      });
    }, { threshold: 0.3 });
    reels.forEach((r) => io.observe(r.el));
  } else {
    reels.forEach((r) => r.setVisible(true));
  }
  doc.addEventListener('visibilitychange', refreshReels);
  if (mqReduce.addEventListener) {
    mqReduce.addEventListener('change', () => { syncLite(); refreshReels(); });
  }

  /* ------------------------------------------------------------- row GIFs */
  // A row's GIF downloads when the row comes within 200 px of the viewport.
  const rowGifs = Array.from(doc.querySelectorAll('.entry-thumb img[data-gif], .entry-extra img[data-gif]'));
  const waiting = new Set(); // near the viewport before the page had finished loading
  let gifIO = null;
  if (!lite() && 'IntersectionObserver' in window) {
    gifIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) { waiting.delete(en.target); return; }
        if (!gifsReady) { waiting.add(en.target); return; }
        play(en.target);
        gifIO.unobserve(en.target);
      });
    }, { rootMargin: '200px 0px' });
    rowGifs.forEach((img) => gifIO.observe(img));
  }

  // GIFs start after everything critical has loaded (or after 4 s at the latest).
  const startGifs = () => {
    if (gifsReady) return;
    gifsReady = true;
    reels.forEach((r) => r.activate());
    waiting.forEach((img) => { play(img); gifIO.unobserve(img); });
    waiting.clear();
    if (!gifIO && !lite()) rowGifs.forEach(play); // no IntersectionObserver: play them all
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
    idle(() => reels.forEach((r) => eager(r.el)));
  };
  if (doc.readyState === 'complete') setTimeout(startGifs, 600);
  else window.addEventListener('load', () => setTimeout(startGifs, 600), { once: true });
  setTimeout(startGifs, 4000);

  /* ------------------------------------------------------- jump to a row */
  function flash(el) {
    if (!el || !el.classList.contains('entry')) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 2400);
  }
  const hashTarget = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    return id ? doc.getElementById(id) : null;
  };
  window.addEventListener('hashchange', () => flash(hashTarget()));

  // A highlight clip leads to its row (the CSS makes the scroll smooth).
  reels.forEach((r) => r.el.addEventListener('click', (e) => {
    if (e.target.closest('.reel-progress')) return;
    const slide = e.target.closest('.slide');
    const id = slide && slide.dataset.target;
    const el = id && doc.getElementById(id);
    if (!el) return;
    if (location.hash === '#' + id) {
      el.scrollIntoView();
      flash(el);
    } else {
      location.hash = id; // fires hashchange, which flashes the row
    }
  }));

  /* -------------------------------------------------------------- top bar */
  // The bar gets a hairline once the page scrolls, and marks the section
  // whose heading has passed a reading line a third of the way down.
  const navLinks = Array.from(doc.querySelectorAll('.topnav a[href^="#"]'));
  const navTargets = navLinks.map((a) => doc.getElementById(decodeURIComponent(a.hash.slice(1))));
  let ticking = false;
  function onScroll() {
    ticking = false;
    if (bar) bar.classList.toggle('is-scrolled', window.scrollY > 4);
    const line = barBottom() + window.innerHeight * 0.3;
    let cur = -1;
    navTargets.forEach((t, k) => { if (t && t.getBoundingClientRect().top <= line) cur = k; });
    if (cur >= 0 && window.innerHeight + window.scrollY >= root.scrollHeight - 2) cur = navTargets.length - 1;
    navLinks.forEach((a, k) => {
      if (k === cur) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }
  const requestScroll = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  };
  window.addEventListener('scroll', requestScroll, { passive: true });
  window.addEventListener('resize', requestScroll);
  onScroll();

  /* ------------------------------------------------------------- lightbox */
  lightbox.className = 'lightbox';
  lightbox.setAttribute('aria-label', 'Enlarged image');
  lightbox.setAttribute('data-zh-aria-label', '放大的图片');
  lightbox.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close" data-zh-aria-label="关闭">'
    + '<svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button>'
    + '<figure><img alt=""><figcaption></figcaption></figure>';
  doc.body.appendChild(lightbox);
  const lbImg = lightbox.querySelector('img');
  const lbCap = lightbox.querySelector('figcaption');

  // Show the image as large as the screen allows, enlarging small GIFs up to 2.5×.
  function fitLightbox() {
    const nw = lbImg.naturalWidth;
    const nh = lbImg.naturalHeight;
    if (!nw || !nh) return;
    const pad = 2 * Math.min(40, Math.max(16, window.innerWidth * 0.04));
    const maxW = Math.min(window.innerWidth - pad, 1152);
    const maxH = window.innerHeight - pad - (lbCap.hidden ? 24 : 96);
    const s = Math.min(maxW / nw, maxH / nh, Math.max(1, 560 / Math.max(nw, nh)), 2.5);
    lbImg.style.width = Math.round(nw * s) + 'px';
    lbImg.style.height = Math.round(nh * s) + 'px';
  }

  function openLightbox(img, caption) {
    if (typeof lightbox.showModal !== 'function') return;
    lbImg.style.width = '';
    lbImg.style.height = '';
    lbImg.onload = fitLightbox;
    lbImg.src = img.currentSrc || img.src; // the GIF if it is playing, else its poster
    lbImg.alt = img.alt;
    lbCap.innerHTML = caption ? caption.innerHTML : '';
    lbCap.hidden = !caption;
    lightbox.showModal();
    if (lbImg.complete) fitLightbox();
    refreshReels();
  }
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lbImg.parentNode || e.target.closest('.lightbox-close')) lightbox.close();
  });
  lightbox.addEventListener('close', () => {
    lbImg.removeAttribute('src');
    refreshReels();
  });
  window.addEventListener('resize', () => { if (lightbox.open) fitLightbox(); });

  // Thumbnails and figures act as buttons that enlarge (in lite mode the first
  // click on a GIF plays it instead).
  const ZOOM = '.thumb-box, .entry-extra .media img';
  const zoomables = Array.from(doc.querySelectorAll(ZOOM));
  zoomables.forEach((el) => {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    if (el.classList.contains('thumb-box')) {
      el.insertAdjacentHTML('afterbegin', '<span class="sr-only"><span class="en">Enlarge: </span><span class="zh">放大：</span></span>');
    }
  });
  function zoom(el) {
    const fig = el.closest('.entry-thumb, .media');
    const img = el.matches('img') ? el : el.querySelector('.thumb-img');
    if (!fig || !img) return;
    if (lite() && fig.classList.contains('has-gif') && !fig.classList.contains('is-playing')) {
      play(img);
      return;
    }
    openLightbox(img, fig.querySelector('figcaption'));
  }
  doc.addEventListener('click', (e) => {
    const el = e.target.closest(ZOOM);
    if (el && !e.button) zoom(el);
  });
  doc.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && zoomables.includes(e.target)) {
      e.preventDefault();
      zoom(e.target);
    }
  });

  /* ------------------------------------------ summary ⇄ technical details */
  // Rows open on a plain-language summary. "Technical details" cross-fades to
  // the in-depth version while the text box eases to its new height, and the
  // row's other figures appear under its thumbnail; the same button then reads
  // "Back to summary".
  const swaps = new WeakMap(); // .views -> the swap currently animating it

  function swapView(box, btn, byKeyboard) {
    const on = !box.classList.contains('is-tech');
    const from = box.querySelector(on ? '.view--summary' : '.view--tech');
    const to = box.querySelector(on ? '.view--tech' : '.view--summary');
    const vTop = barBottom() + 12; // top of the readable area, just under the top bar

    // Start from wherever an interrupted swap had got to.
    const r0 = box.getBoundingClientRect();
    const prev = swaps.get(box);
    const fromO = prev ? +getComputedStyle(from).opacity : 1;
    const toO = prev ? +getComputedStyle(to).opacity : 0;
    if (prev) prev.stop();

    box.classList.toggle('is-tech', on);
    const entry = box.closest('.entry');
    if (entry) entry.classList.toggle('is-tech', on); // shows the figures under the thumbnail
    btn.setAttribute('aria-expanded', String(on));
    if (byKeyboard) to.focus({ preventScroll: true }); // keyboard and screen-reader users read on from here

    // Measured in the final layout, before any animation applies.
    const h1 = box.getBoundingClientRect().height;
    const x1 = box.getBoundingClientRect().top;
    const x0 = r0.top;
    const inView = x0 >= vTop; // was the start of the text on screen?
    // If it was not (and still is not), scroll the row's title back to just
    // under the top bar, so the reader sees what they are reading.
    const glide = !inView && x1 < vTop ? box.parentNode.getBoundingClientRect().top - vTop : 0;

    if (reduced()) {
      nudge(inView ? Math.min(0, x1 - x0) : glide);
      return;
    }

    from.classList.add('is-leaving'); // overlaid while it fades out
    box.classList.add('is-swapping');
    const anims = [
      box.animate([{ height: r0.height + 'px' }, { height: h1 + 'px' }], { duration: 440, easing: EASE }),
      from.animate([{ opacity: fromO, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px)' }],
        { duration: 180, easing: 'ease-out', fill: 'forwards' }),
      to.animate([{ opacity: toO, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, delay: 110, easing: EASE, fill: 'backwards' }),
    ];

    let raf = 0;
    root.style.overflowAnchor = 'none';
    if (inView) {
      // Keep the text where the reader is looking (only upward drift is corrected).
      const hold = () => {
        const dy = box.getBoundingClientRect().top - x0;
        if (dy < -0.5) nudge(dy);
        raf = requestAnimationFrame(hold);
      };
      raf = requestAnimationFrame(hold);
    } else if (glide) {
      window.scrollBy({ top: glide, behavior: 'smooth' });
    }

    const swap = {
      stop() {
        cancelAnimationFrame(raf);
        anims.forEach((a) => a.cancel());
        from.classList.remove('is-leaving');
        box.classList.remove('is-swapping');
        root.style.overflowAnchor = '';
        if (swaps.get(box) === swap) swaps.delete(box);
      },
    };
    swaps.set(box, swap);
    Promise.all(anims.map((a) => a.finished)).then(() => swap.stop(), () => {});
  }

  doc.querySelectorAll('.views').forEach((box, k) => {
    const sum = box.querySelector('.view--summary');
    const tech = box.querySelector('.view--tech');
    if (!sum || !tech) return;
    const entry = box.closest('.entry');
    const base = entry && entry.id ? entry.id : 'views-' + k;
    if (!tech.id) tech.id = base + '-tech';
    const figs = entry && entry.querySelector(':scope > .entry-extra--tech');
    if (figs && !figs.id) figs.id = base + '-figures';
    sum.tabIndex = -1;
    tech.tabIndex = -1;

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'tech-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', tech.id + (figs ? ' ' + figs.id : ''));
    btn.innerHTML = '<span class="when-closed"><span class="en">Technical details</span><span class="zh">技术细节</span></span>'
      + '<span class="when-open"><span class="en">Back to summary</span><span class="zh">返回简介</span></span>'
      + '<svg class="i" aria-hidden="true"><use href="#i-chevron-down"/></svg>';
    btn.addEventListener('click', (e) => swapView(box, btn, e.detail === 0));

    // The button leads the row's links (source code, demo…), which come last.
    const body = box.parentNode;
    let row = Array.prototype.find.call(body.children, (c) => c.classList.contains('links'));
    if (!row) {
      row = doc.createElement('div');
      row.className = 'links';
      body.appendChild(row);
    }
    row.prepend(btn);
  });

  /* -------------------------------------------------------------- language */
  // Every string is in the page twice, as <span class="en"> and <span class="zh">,
  // and html.is-zh (set in <head> before the first paint) shows one of them.
  // Attributes keep their Chinese in data-zh-*.
  const TITLE = { en: doc.title, zh: 'Haocheng Li — 机器人与具身智能' };
  const ATTRS = ['alt', 'aria-label'];
  const attrEls = Array.from(doc.querySelectorAll(ATTRS.map((a) => '[data-zh-' + a + ']').join(',')));
  const enAttrs = new Map(attrEls.map((el) => [el, ATTRS.map((a) => el.getAttribute(a))]));
  const langButtons = doc.querySelectorAll('.lang-switch [data-lang]');
  const langNow = () => (root.classList.contains('is-zh') ? 'zh' : 'en');

  function applyLang(lang) {
    const zh = lang === 'zh';
    root.classList.toggle('is-zh', zh);
    root.lang = zh ? 'zh-CN' : 'en';
    doc.title = TITLE[lang];
    attrEls.forEach((el) => {
      const en = enAttrs.get(el);
      ATTRS.forEach((a, k) => {
        const v = zh ? el.getAttribute('data-zh-' + a) : en[k];
        if (v !== null) el.setAttribute(a, v);
      });
    });
    langButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }

  // Text changes length between languages; keep the first block still on screen
  // where it was, so the reader does not lose their place.
  function readingAnchor() {
    const top = barBottom();
    const blocks = doc.querySelectorAll('.about-text, .about-media, .section-head, .group-title, .org-head, .entry, .misc-card, .site-footer');
    const el = Array.prototype.find.call(blocks, (b) => b.getBoundingClientRect().bottom > top + 1);
    if (!el || window.scrollY < 1) return () => {};
    const y = el.getBoundingClientRect().top;
    return () => {
      const dy = el.getBoundingClientRect().top - y;
      if (Math.abs(dy) >= 1) nudge(dy);
    };
  }

  function setLang(lang) {
    if (lang === langNow()) return;
    try { localStorage.setItem('lang', lang); } catch (e) { /* storage blocked: still switch */ }
    const url = new URL(location.href); // keep the link shareable in the chosen language
    if (lang === 'zh') url.searchParams.set('lang', 'zh');
    else url.searchParams.delete('lang');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    const restore = readingAnchor();
    const swap = () => { applyLang(lang); restore(); };
    if (doc.startViewTransition && !reduced()) doc.startViewTransition(swap); // a soft cross-fade
    else swap();
  }

  applyLang(langNow()); // alt text, title and button states follow the class set in <head>
  langButtons.forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

  // A link straight to a row (e.g. index.html#r-sage) highlights it on arrival.
  if (hashTarget()) {
    const greet = () => flash(hashTarget());
    if (doc.readyState === 'complete') greet();
    else window.addEventListener('load', greet, { once: true });
  }
})();
