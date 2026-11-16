/* Haocheng Li — site interactions
 *
 * 1. Reels: the rolling demos on each home-page card. Every slide paints a small
 *    WebP poster first; the active slide is upgraded to its GIF once the page has
 *    finished loading, and the next slide's GIF is warmed in the background.
 * 2. Sheets: "See more details" expands the card into a full-screen detail view
 *    (clip-path animation from the card's rectangle) without a page load. Each
 *    sheet gets a history entry, so Back / Esc close it and #projects, #work,
 *    #research deep-link straight into one.
 * 3. GIFs inside a sheet only download when they scroll near the viewport.
 *    With reduced motion or Save-Data they become click-to-play.
 * 4. Project and research entries open on a plain-language summary; a
 *    "Technical details" button cross-fades to the in-depth version.
 * 5. English / 中文: every string is in the page in both languages and a class
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

  // shared state
  const sheets = {};
  const cards = {};
  let current = null; // name of the open sheet
  let busy = false; // a sheet animation is running
  let pushed = false; // we pushed the history entry for the open sheet
  let gifsReady = false; // home-page GIFs wait until the page has loaded

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
      const fig = img.closest('.media, .slide');
      if (fig) fig.classList.add('is-playing');
    }, () => { delete img.dataset.state; });
  }

  const eager = (scope) => scope.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = 'eager'; });

  /* ----------------------------------------------------------------- reels */
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
      this.stagger = 600 + index * 1400; // so the three reels never move in unison
      this.dwell = 4600;
      if (this.n < 2) return;

      // A copy of the first slide at the end makes the loop seamless.
      const clone = this.slides[0].cloneNode(true);
      clone.classList.add('is-clone');
      clone.setAttribute('aria-hidden', 'true');
      this.track.appendChild(clone);
      this.cloneImg = clone.querySelector('.slide-img');

      const bar = doc.createElement('div');
      bar.className = 'reel-progress';
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
        bar.appendChild(b);
        return b.querySelector('.f');
      });
      // one tab stop per reel; arrow keys move between slides (focus also pauses it)
      bar.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const k = (this.i % this.n + step + this.n) % this.n;
        this.go(k);
        this.fills[k].parentNode.parentNode.focus();
      });
      el.appendChild(bar);
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
      return this.n > 1 && this.visible && !this.held && !doc.hidden && !reduced() && current === null;
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

  // GIFs start after everything critical has loaded (or after 4 s at the latest).
  const startGifs = () => {
    if (gifsReady) return;
    gifsReady = true;
    reels.forEach((r) => r.activate());
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
    idle(() => reels.forEach((r) => eager(r.el)));
  };
  if (doc.readyState === 'complete') setTimeout(startGifs, 600);
  else window.addEventListener('load', () => setTimeout(startGifs, 600), { once: true });
  setTimeout(startGifs, 4000);

  /* ---------------------------------------------------------------- sheets */
  doc.querySelectorAll('.sheet[id]').forEach((s) => { sheets[s.id] = s; });
  doc.querySelectorAll('.hub-card[data-sheet]').forEach((c) => { cards[c.dataset.sheet] = c; });

  const scrim = doc.createElement('div');
  scrim.className = 'scrim';
  doc.body.appendChild(scrim);

  const pageParts = () => [doc.querySelector('.skip'), doc.querySelector('.site-header'), doc.getElementById('main'), doc.querySelector('.site-footer')];

  function lock(on) {
    if (on) {
      const bar = window.innerWidth - root.clientWidth; // keep layout still when the scrollbar goes
      if (bar > 0) root.style.paddingRight = bar + 'px';
      root.classList.add('is-locked');
    } else {
      root.classList.remove('is-locked');
      root.style.paddingRight = '';
    }
    pageParts().forEach((el) => { if (el) el.inert = on; });
  }

  // clip-path inset() matching an element's on-screen box, or null if it is off-screen.
  function insetFor(el) {
    const r = el.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (r.bottom < 48 || r.top > h - 48) return null;
    const px = (v) => Math.max(0, Math.round(v)) + 'px';
    return 'inset(' + px(r.top) + ' ' + px(w - r.right) + ' ' + px(h - r.bottom) + ' ' + px(r.left) + ' round 22px)';
  }
  const FULL = 'inset(0px 0px 0px 0px round 0px)';
  const MID = 'inset(12% 9% 12% 9% round 22px)';

  const scroller = (sheet) => sheet.querySelector('.sheet-scroll');

  function reveal(sheet, id, smooth) {
    const el = id && doc.getElementById(id);
    if (!el || !sheet.contains(el)) return;
    const sc = scroller(sheet);
    const bar = sheet.querySelector('.sheet-bar');
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (bar ? bar.offsetHeight : 0) - 6;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  }

  function flash(id) {
    const el = id && doc.getElementById(id);
    if (!el || !el.classList.contains('entry')) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 2400);
  }

  function focusHeading(sheet) {
    const h = sheet.querySelector('h2[tabindex]');
    if (h) h.focus({ preventScroll: true });
  }

  const wired = new Set();
  function wire(sheet) {
    if (wired.has(sheet)) return;
    wired.add(sheet);
    const sc = scroller(sheet);
    sc.addEventListener('scroll', () => sheet.classList.toggle('is-scrolled', sc.scrollTop > 4), { passive: true });
    if (lite()) return; // click-to-play instead
    const gifs = sheet.querySelectorAll('.media img[data-gif]');
    if (!('IntersectionObserver' in window)) { gifs.forEach(play); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        play(en.target);
        io.unobserve(en.target);
      });
    }, { root: sc, rootMargin: '250px 0px' });
    gifs.forEach((img) => io.observe(img));
  }

  function show(sheet, target) {
    sheet.classList.add('is-open');
    sheet.classList.remove('is-scrolled');
    scroller(sheet).scrollTop = 0;
    wire(sheet);
    if (target) reveal(sheet, target, false);
  }

  function openSheet(name, opts) {
    opts = opts || {};
    const sheet = sheets[name];
    if (!sheet || busy) return;
    if (current === name) { if (opts.target) reveal(sheet, opts.target, true); return; }
    if (current) { switchSheet(name, opts); return; }

    const from = opts.from || cards[name];
    const animate = !opts.instant && !reduced();
    const start = animate && from ? insetFor(from) : null; // measure before the page locks

    busy = true;
    current = name;
    if (opts.push !== false) {
      history.pushState({ sheet: name }, '', '#' + name);
      pushed = true;
    }
    lock(true);
    refreshReels();
    show(sheet, opts.target);

    const done = () => {
      busy = false;
      focusHeading(sheet);
      flash(opts.target);
      sync();
    };
    if (opts.instant) { done(); return; }
    if (!animate) {
      sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }).finished.then(done, done);
      return;
    }

    scrim.classList.add('is-on');
    const grow = sheet.animate([
      { clipPath: start || MID, opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.28 },
      { clipPath: FULL, opacity: 1, offset: 1 },
    ], { duration: 560, easing: EASE });
    sheet.querySelector('.sheet-inner').animate(
      [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }],
      { duration: 460, delay: 110, easing: EASE, fill: 'backwards' }
    );
    grow.finished.then(done, done);
  }

  function closeSheet() {
    if (!current || busy) return;
    const name = current;
    const sheet = sheets[name];
    const card = cards[name];
    busy = true;

    const inner = sheet.querySelector('.sheet-inner');
    const anims = [];
    const finish = () => {
      sheet.classList.remove('is-open');
      scrim.classList.remove('is-on');
      anims.forEach((a) => a.cancel());
      lock(false);
      current = null;
      pushed = false;
      busy = false;
      refreshReels();
      const btn = card && card.querySelector('.btn');
      if (btn) btn.focus({ preventScroll: true });
      sync();
    };
    if (reduced()) { finish(); return; }

    const end = card ? insetFor(card) : null;
    scrim.classList.remove('is-on');
    anims.push(inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170, easing: 'ease-out', fill: 'forwards' }));
    const shrink = sheet.animate([
      { clipPath: FULL, opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.55 },
      { clipPath: end || MID, opacity: 0, offset: 1 },
    ], { duration: 430, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    anims.push(shrink);
    shrink.finished.then(finish, finish);
  }

  function switchSheet(name, opts) {
    opts = opts || {};
    const from = sheets[current];
    const to = sheets[name];
    if (!to || busy || name === current) return;
    busy = true;
    history.replaceState({ sheet: name }, '', '#' + name);
    to.classList.add('is-front');
    show(to, opts.target);
    const done = () => {
      from.classList.remove('is-open');
      to.classList.remove('is-front');
      current = name;
      busy = false;
      focusHeading(to);
      flash(opts.target);
      sync();
    };
    if (reduced()) { done(); return; }
    to.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE })
      .finished.then(done, done);
  }

  // Keep the open sheet in step with the URL (Back/Forward, edited hashes).
  const fromHash = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    return sheets[h] ? h : null;
  };
  function wanted() {
    const s = history.state && history.state.sheet;
    return s && sheets[s] ? s : fromHash();
  }
  function sync() {
    if (busy) return; // re-checked when the running animation ends
    const want = wanted();
    if (want && want !== current) openSheet(want, { push: false });
    else if (!want && current) closeSheet();
  }
  let backPending = false;
  window.addEventListener('popstate', () => {
    backPending = false;
    sync();
  });

  // Close requests update the URL first; if an animation is still running,
  // sync() applies the close as soon as it ends.
  function requestClose() {
    if (!current || backPending) return;
    if (pushed && history.state && history.state.sheet) {
      backPending = true;
      history.back(); // popstate -> sync -> closeSheet
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      closeSheet();
    }
  }

  // Prefetch the first images of a sheet as soon as the visitor shows interest.
  function warm(name) {
    const s = sheets[name];
    if (!s) return;
    Array.prototype.slice.call(s.querySelectorAll('.sheet-body img[loading="lazy"]'), 0, 3).forEach((im) => { im.loading = 'eager'; });
  }

  Object.keys(cards).forEach((name) => {
    const card = cards[name];
    card.addEventListener('click', (e) => {
      if (e.target.closest('.reel-progress')) return;
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let "open in new tab" work
      e.preventDefault();
      const slide = e.target.closest('.slide');
      openSheet(name, { from: card, target: slide ? slide.dataset.target : null });
    });
    const warmUp = () => warm(name);
    card.addEventListener('pointerenter', warmUp, { once: true });
    card.addEventListener('focusin', warmUp, { once: true });
  });

  doc.addEventListener('click', (e) => {
    if (!current) return;
    const t = e.target;
    if (t.closest('[data-close]')) { e.preventDefault(); requestClose(); return; }
    const sw = t.closest('[data-switch]');
    if (sw) {
      e.preventDefault();
      if (sw.dataset.switch === current) reveal(sheets[current], sw.dataset.target, true);
      else switchSheet(sw.dataset.switch, { target: sw.dataset.target });
      return;
    }
    const jump = t.closest('[data-jump]');
    if (jump) { e.preventDefault(); reveal(sheets[current], jump.dataset.jump, true); return; }
    const fig = t.closest('.media.has-gif');
    if (fig && lite()) play(fig.querySelector('img[data-gif]'));
  });

  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) { e.preventDefault(); requestClose(); }
  });

  /* ------------------------------------------ summary ⇄ technical details */
  // Entries open on a plain-language summary. "Technical details" cross-fades
  // to the in-depth version while the text box eases to its new height; the
  // same button then reads "Back to summary".
  const swaps = new WeakMap(); // .views -> the swap currently animating it

  function swapView(box, btn, byKeyboard) {
    const on = !box.classList.contains('is-tech');
    const from = box.querySelector(on ? '.view--summary' : '.view--tech');
    const to = box.querySelector(on ? '.view--tech' : '.view--summary');
    const sheet = box.closest('.sheet');
    const sc = sheet && sheet.classList.contains('is-open') ? scroller(sheet) : null;
    let vTop = 0; // top of the readable area, just under the sticky bar
    if (sc) {
      const bar = sheet.querySelector('.sheet-bar');
      vTop = sc.getBoundingClientRect().top + (bar ? bar.offsetHeight : 0) + 12;
    }

    // Start from wherever an interrupted swap had got to.
    const r0 = box.getBoundingClientRect();
    const prev = swaps.get(box);
    const fromO = prev ? +getComputedStyle(from).opacity : 1;
    const toO = prev ? +getComputedStyle(to).opacity : 0;
    if (prev) prev.stop();

    box.classList.toggle('is-tech', on);
    btn.setAttribute('aria-expanded', String(on));
    if (byKeyboard) to.focus({ preventScroll: true }); // keyboard and screen-reader users read on from here

    // Measured in the final layout, before any animation applies.
    const h1 = box.getBoundingClientRect().height;
    const x1 = box.getBoundingClientRect().top;
    const x0 = r0.top;
    const inView = x0 >= vTop; // was the start of the text on screen?
    // If it was not (and still is not), scroll the entry's header back to just
    // under the sticky bar, so the reader sees what they are reading.
    const glide = sc && !inView && x1 < vTop ? box.parentNode.getBoundingClientRect().top - vTop : 0;

    if (reduced()) {
      if (sc) sc.scrollTop += inView ? Math.min(0, x1 - x0) : glide;
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
    if (sc) {
      sc.style.overflowAnchor = 'none';
      if (inView) {
        // Keep the text where the reader is looking: when it grows past the media
        // column, the sticky text column would otherwise slide up out of view.
        // (Only upward drift is corrected; a column pinned at its sticky offset
        // does not move with scrolling, so chasing downward drift never settles.)
        const hold = () => {
          const dy = box.getBoundingClientRect().top - x0;
          if (dy < -0.5) sc.scrollTop += dy;
          raf = requestAnimationFrame(hold);
        };
        raf = requestAnimationFrame(hold);
      } else if (glide) {
        sc.scrollBy({ top: glide, behavior: 'smooth' });
      }
    }

    const swap = {
      stop() {
        cancelAnimationFrame(raf);
        anims.forEach((a) => a.cancel());
        from.classList.remove('is-leaving');
        box.classList.remove('is-swapping');
        if (sc) sc.style.overflowAnchor = '';
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
    if (!tech.id) tech.id = (entry && entry.id ? entry.id : 'views-' + k) + '-tech';
    sum.tabIndex = -1;
    tech.tabIndex = -1;

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'tech-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', tech.id);
    btn.innerHTML = '<span class="when-closed"><span class="en">Technical details</span><span class="zh">技术细节</span></span>'
      + '<span class="when-open"><span class="en">Back to summary</span><span class="zh">返回简介</span></span>'
      + '<svg class="i" aria-hidden="true"><use href="#i-chevron-down"/></svg>';
    btn.addEventListener('click', (e) => swapView(box, btn, e.detail === 0));

    let row = box.nextElementSibling; // share the row with the entry's links
    if (!row || !row.classList.contains('links')) {
      row = doc.createElement('div');
      row.className = 'links';
      box.after(row);
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
    const sheet = current && sheets[current];
    const sc = sheet ? scroller(sheet) : null;
    let top = 0;
    if (sc) {
      const bar = sheet.querySelector('.sheet-bar');
      top = sc.getBoundingClientRect().top + (bar ? bar.offsetHeight : 0);
    }
    const blocks = sheet
      ? sheet.querySelectorAll('.sheet-head, .group-title, .org-head, .entry')
      : doc.querySelectorAll('.hero, .hub-card, .misc .section-head, .misc-card, .site-footer');
    const el = Array.prototype.find.call(blocks, (b) => b.getBoundingClientRect().bottom > top + 1);
    if (!el) return () => {};
    const y = el.getBoundingClientRect().top;
    return () => {
      const dy = el.getBoundingClientRect().top - y;
      if (Math.abs(dy) < 1) return;
      if (sc) sc.scrollTop += dy;
      else window.scrollBy(0, dy);
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

  // Deep link (e.g. index.html#research): open immediately, no animation.
  const initial = fromHash();
  if (initial) {
    history.replaceState({ sheet: initial }, '', location.href);
    openSheet(initial, { push: false, instant: true });
    // the footer is parsed after this script; make it inert too
    doc.addEventListener('DOMContentLoaded', () => { if (current) lock(true); }, { once: true });
  }
})();
