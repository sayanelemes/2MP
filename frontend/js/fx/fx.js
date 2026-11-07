/* CQA · интерактивные эффекты интерфейса (только оформление, без логики приложения).
   Перенесены на чистый JS идеи React Bits и 21st.dev / Magic UI:
   SplitText, CountUp, DecryptedText, SpotlightCard, Magnet, TiltedCard, ClickSpark,
   скользящие подложки переключателей и вкладок, переход к реплике-доказательству,
   модальное окно, демо-плеер звонка, уведомления, тема и закрепление панели.
   Каждый эффект включается атрибутом в разметке и не мешает основному JS приложения. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; } return null; }
  function onVisible(el, cb) {
    if (!('IntersectionObserver' in window)) { cb(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.disconnect(); cb(); } });
    }, { threshold: 0.2 });
    io.observe(el);
  }

  /* ---------- Тема ---------- */
  function initTheme() {
    $all('[data-theme-toggle]').forEach(function (btn) {
      var sync = function () { btn.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'light' ? 'true' : 'false'); };
      sync();
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', next);
        store('cqa-theme', next);
        sync();
        window.dispatchEvent(new CustomEvent('cqa:theme', { detail: next }));
      });
    });
  }

  /* ---------- Закрепление боковой панели ---------- */
  function initRailPin() {
    $all('[data-rail-pin]').forEach(function (btn) {
      var sync = function () { btn.setAttribute('aria-pressed', root.classList.contains('rail-pinned') ? 'true' : 'false'); };
      sync();
      btn.addEventListener('click', function () {
        root.classList.toggle('rail-pinned');
        store('cqa-rail', root.classList.contains('rail-pinned') ? 'pinned' : 'auto');
        sync();
        setTimeout(refreshThumbs, 320);
      });
    });
  }

  /* ---------- SplitText / BlurText: буквы проявляются из размытия ---------- */
  function initSplit() {
    $all('[data-split]').forEach(function (el) {
      if (reduce) { el.classList.add('is-split'); return; }
      var text = el.textContent.replace(/\s+/g, ' ').trim();
      el.setAttribute('aria-label', text);
      el.textContent = '';
      var i = 0;
      text.split(' ').forEach(function (word, wi) {
        var w = document.createElement('span');
        w.className = 'word';
        w.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(word, function (ch) {
          var c = document.createElement('span');
          c.className = 'char';
          c.textContent = ch;
          c.style.setProperty('--i', i++);
          w.appendChild(c);
        });
        el.appendChild(w);
        if (wi < text.split(' ').length - 1) el.appendChild(document.createTextNode(' '));
      });
      el.classList.add('is-split');
    });
  }

  /* ---------- CountUp: число набегает от 0 (или data-from) до значения ---------- */
  function formatNum(v, decimals) {
    return v.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function initCount() {
    $all('[data-count]').forEach(function (el) {
      var target = parseFloat(String(el.getAttribute('data-count')).replace(',', '.'));
      if (!isFinite(target)) return;
      var decimals = el.hasAttribute('data-decimals') ? +el.getAttribute('data-decimals') : ((String(el.getAttribute('data-count')).split(/[.,]/)[1] || '').length);
      var from = parseFloat(el.getAttribute('data-from') || '0');
      var duration = +(el.getAttribute('data-duration') || 1600);
      var delay = +(el.getAttribute('data-delay') || 0);
      var finalText = el.textContent;
      if (reduce) { el.classList.add('is-counting'); return; }
      el.textContent = formatNum(from, decimals);
      onVisible(el, function () {
        setTimeout(function () {
          el.classList.add('is-counting');
          var start = performance.now();
          var tick = function (now) {
            var t = Math.min(1, (now - start) / duration);
            var e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // easeOutExpo
            el.textContent = t < 1 ? formatNum(from + (target - from) * e, decimals) : finalText;
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, delay);
      });
    });
  }

  /* ---------- DecryptedText: символы «расшифровываются» слева направо ---------- */
  function initDecrypt() {
    var glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    $all('[data-decrypt]').forEach(function (el) {
      if (reduce) return;
      var text = el.textContent;
      el.setAttribute('aria-label', text);
      var duration = +(el.getAttribute('data-duration') || 1100);
      var start = performance.now() + +(el.getAttribute('data-delay') || 150);
      var tick = function (now) {
        var t = Math.max(0, (now - start) / duration);
        var done = Math.floor(t * text.length);
        var html = '';
        for (var i = 0; i < text.length; i++) {
          var ch = text[i];
          if (i < done || ch === '-' || ch === ' ') html += ch;
          else html += '<span class="decrypt-char" aria-hidden="true">' + glyphs[(Math.random() * glyphs.length) | 0].toLowerCase() + '</span>';
        }
        el.innerHTML = html;
        if (done < text.length) requestAnimationFrame(tick);
        else el.textContent = text;
      };
      requestAnimationFrame(tick);
    });
  }

  /* ---------- Spotlight: свет и рамка следуют за курсором (.spot) ---------- */
  function initSpotlight() {
    if (!finePointer) return;
    var pending = null;
    var pos = { x: 0, y: 0 };
    document.addEventListener('pointermove', function (e) {
      pos.x = e.clientX; pos.y = e.clientY;
      var card = e.target.closest && e.target.closest('.spot');
      if (!card || pending) return;
      pending = requestAnimationFrame(function () {
        pending = null;
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (pos.x - r.left) + 'px');
        card.style.setProperty('--my', (pos.y - r.top) + 'px');
      });
    }, { passive: true });
  }

  /* ---------- Magnet: кнопка тянется к курсору (один слушатель, rAF, кэш размеров) ---------- */
  function initMagnet() {
    if (reduce || !finePointer) return;
    var items = $all('[data-magnet]');
    if (!items.length) return;
    var rects = null;
    var pending = 0;
    var px = 0;
    var py = 0;
    var forget = function () { rects = null; };
    window.addEventListener('scroll', forget, { passive: true });
    window.addEventListener('resize', forget);
    window.addEventListener('pointermove', function (e) {
      px = e.clientX; py = e.clientY;
      if (pending) return;
      pending = requestAnimationFrame(function () {
        pending = 0;
        if (!rects) rects = items.map(function (el) { return el.getBoundingClientRect(); });
        items.forEach(function (el, i) {
          var r = rects[i];
          var pad = 40;
          var inside = r.width && px > r.left - pad && px < r.right + pad && py > r.top - pad && py < r.bottom + pad;
          if (inside) {
            var k = +(el.getAttribute('data-magnet') || 0.3);
            var dx = Math.max(-10, Math.min(10, (px - (r.left + r.width / 2)) * k));
            var dy = Math.max(-8, Math.min(8, (py - (r.top + r.height / 2)) * k));
            el.classList.add('is-magnet');
            el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
          } else if (el.classList.contains('is-magnet')) {
            el.classList.remove('is-magnet');
            el.style.transform = '';
          }
        });
      });
    }, { passive: true });
  }

  /* ---------- Tilt: лёгкий 3D-наклон карточки ---------- */
  function initTilt() {
    if (reduce || !finePointer) return;
    $all('[data-tilt]').forEach(function (el) {
      var max = +(el.getAttribute('data-tilt') || 5);
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        el.classList.add('is-tilting');
        el.style.setProperty('--rx', (-y * max).toFixed(2) + 'deg');
        el.style.setProperty('--ry', (x * max * 1.3).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', function () {
        el.classList.remove('is-tilting');
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------- ClickSpark (React Bits): искры при нажатии + большая вспышка успеха ---------- */
  var burst = function () {};
  function initSparks() {
    if (reduce) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'spark-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var bursts = [];
    var raf = 0;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var resize = function () {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    };
    resize();
    window.addEventListener('resize', resize);
    var colors = function () {
      var css = getComputedStyle(root);
      return [css.getPropertyValue('--signal').trim() || '#2EE57E', css.getPropertyValue('--lime').trim() || '#D4F75C', css.getPropertyValue('--teal').trim() || '#3FE0C5'];
    };
    var DURATION = 520;
    var draw = function (now) {
      raf = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bursts = bursts.filter(function (b) { return now - b.start < DURATION; });
      bursts.forEach(function (b) {
        var p = (now - b.start) / DURATION;
        var e = 1 - Math.pow(1 - p, 3);
        b.sparks.forEach(function (s) {
          var dist = b.radius * s.reach * e;
          var len = 12 * s.scale * Math.pow(1 - p, 1.6);
          var x1 = b.x + Math.cos(s.angle) * dist;
          var y1 = b.y + Math.sin(s.angle) * dist;
          var x2 = b.x + Math.cos(s.angle) * (dist + len);
          var y2 = b.y + Math.sin(s.angle) * (dist + len);
          ctx.strokeStyle = s.color;
          ctx.lineCap = 'round';
          ctx.globalAlpha = (1 - p) * 0.25;
          ctx.lineWidth = 7;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.globalAlpha = 1 - p * p;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        });
      });
      ctx.globalAlpha = 1;
      if (bursts.length) raf = requestAnimationFrame(draw);
    };
    var spawn = function (x, y, count, radius) {
      var palette = colors();
      var sparks = [];
      for (var i = 0; i < count; i++) {
        sparks.push({
          angle: (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4,
          reach: 0.7 + Math.random() * 0.5,
          scale: 0.8 + Math.random() * 0.6,
          color: palette[i % palette.length]
        });
      }
      bursts.push({ x: x, y: y, start: performance.now(), radius: radius, sparks: sparks });
      if (bursts.length > 24) bursts.shift();
      if (!raf) raf = requestAnimationFrame(draw);
    };
    burst = function (x, y) { spawn(x, y, 18, 70); setTimeout(function () { spawn(x, y, 12, 40); }, 120); };
    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('a, button, label, summary, [role="button"], [role="tab"], .choice, .crit-row, .wave')) return;
      spawn(e.clientX, e.clientY, 10, 34);
    }, { passive: true });
  }

  /* ---------- Скользящие подложки: .seg и .tabs ---------- */
  var thumbHosts = [];
  function placeThumb(host) {
    var thumb = host.querySelector(':scope > .seg__thumb, :scope > .tabs__thumb');
    var active = host.querySelector('.is-active, [aria-pressed="true"], [aria-selected="true"]');
    if (!thumb || !active) return;
    var hr = host.getBoundingClientRect();
    var ar = active.getBoundingClientRect();
    thumb.style.setProperty('--x', (ar.left - hr.left - (host.classList.contains('tabs') ? 0 : 0)) + 'px');
    thumb.style.setProperty('--w', ar.width + 'px');
    host.classList.add('has-thumb');
  }
  function refreshThumbs() { thumbHosts.forEach(placeThumb); }
  function initThumbs() {
    $all('.seg, .tabs').forEach(function (host) {
      var isTabs = host.classList.contains('tabs');
      if (!host.querySelector(':scope > .seg__thumb, :scope > .tabs__thumb')) {
        var t = document.createElement('span');
        t.className = isTabs ? 'tabs__thumb' : 'seg__thumb';
        t.setAttribute('aria-hidden', 'true');
        host.insertBefore(t, host.firstChild);
      }
      thumbHosts.push(host);
      placeThumb(host);
      host.addEventListener('click', function (e) {
        var item = e.target.closest(isTabs ? '.tabs__item' : '.seg__item');
        if (!item || !host.contains(item) || host.hasAttribute('data-static')) return;
        if (item.tagName === 'A' && item.getAttribute('href') && item.getAttribute('href') !== '#') return;
        e.preventDefault();
        $all(isTabs ? '.tabs__item' : '.seg__item', host).forEach(function (it) {
          it.classList.remove('is-active');
          if (it.hasAttribute('aria-pressed')) it.setAttribute('aria-pressed', 'false');
          if (it.hasAttribute('aria-selected')) it.setAttribute('aria-selected', 'false');
        });
        item.classList.add('is-active');
        if (item.hasAttribute('aria-pressed')) item.setAttribute('aria-pressed', 'true');
        if (item.hasAttribute('aria-selected')) item.setAttribute('aria-selected', 'true');
        placeThumb(host);
      });
    });
    window.addEventListener('resize', refreshThumbs);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshThumbs);
  }

  /* ---------- Чипы языков и выбор строк (визуальное состояние) ---------- */
  function initToggles() {
    document.addEventListener('click', function (e) {
      var chip = e.target.closest('.lang-chip');
      if (chip) chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      var row = e.target.closest('.crit-row');
      if (row && row.getAttribute('href') === '#') {
        e.preventDefault();
        $all('.crit-row.is-selected').forEach(function (r) { r.classList.remove('is-selected'); });
        row.classList.add('is-selected');
      }
    });
    document.addEventListener('change', function (e) {
      var box = e.target.closest('.table tbody .check input');
      if (box) box.closest('tr').classList.toggle('is-selected', box.checked);
    });
  }

  /* ---------- Переход к реплике-доказательству и к карточке критерия ---------- */
  function focusTurn(turn) {
    var box = turn.closest('.transcript__body');
    if (box) {
      var top = turn.offsetTop - box.clientHeight / 2 + turn.offsetHeight / 2;
      box.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
      var panel = box.closest('.transcript');
      if (panel) {
        var r = panel.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
    } else {
      turn.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
    turn.classList.remove('is-focus');
    void turn.offsetWidth;
    turn.classList.add('is-focus');
    clearTimeout(turn._focusTimer);
    turn._focusTimer = setTimeout(function () { turn.classList.remove('is-focus'); }, 2200);
  }
  function initEvidenceLinks() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#t-"], a[href^="#c-"]');
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      if (history.replaceState) history.replaceState(null, '', '#' + id);
      if (id.indexOf('t-') === 0) {
        focusTurn(target);
        var at = a.getAttribute('data-at');
        if (at) seekPlayer(parseFloat(at), target);
      } else {
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        target.classList.add('is-lit');
        setTimeout(function () { target.classList.remove('is-lit'); }, 1400);
      }
    });
    if (location.hash && /^#t-\d+$/.test(location.hash)) {
      var t = document.getElementById(location.hash.slice(1));
      if (t) setTimeout(function () { focusTurn(t); }, 600);
    }
  }

  /* ---------- Модальное окно: ссылки на #id модалки, закрытие по Esc и фону ---------- */
  function initModals() {
    var lastFocus = null;
    function open(modal) {
      lastFocus = document.activeElement;
      modal.classList.add('is-open');
      var field = modal.querySelector('select, textarea, input, button');
      if (field) setTimeout(function () { field.focus(); }, 60);
    }
    function close(modal) {
      modal.classList.remove('is-open');
      if (location.hash === '#' + modal.id && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      if (lastFocus) lastFocus.focus();
    }
    document.addEventListener('click', function (e) {
      var opener = e.target.closest('a[href^="#"]');
      if (opener) {
        var target = document.getElementById(opener.getAttribute('href').slice(1));
        if (target && target.classList.contains('modal')) { e.preventDefault(); open(target); return; }
      }
      var closer = e.target.closest('[data-close]');
      if (closer) {
        var m = closer.closest('.modal');
        if (m) { e.preventDefault(); close(m); }
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      $all('.modal.is-open, .modal:target').forEach(close);
    });
  }

  /* ---------- Демо-плеер звонка ---------- */
  var playerState = null;
  function seekPlayer(percent, turn) {
    if (!playerState) return;
    playerState.pos = Math.max(0, Math.min(1, percent / 100));
    playerState.paint();
    if (turn) {
      $all('.turn.is-playing').forEach(function (t) { t.classList.remove('is-playing'); });
      turn.classList.add('is-playing');
    }
  }
  function initPlayer() {
    var player = document.querySelector('.player');
    if (!player) return;
    // Одна или несколько дорожек (.wave): у звонка — общая, в аналитике — клиент и оператор отдельно
    var waves = $all('.wave', player);
    if (!waves.length) return;
    var lanes = waves.map(function (w) { return { el: w, bars: $all('i', w), n: -1 }; });
    var heads = $all('.wave__head, .audio__head', player);
    var time = player.querySelector('[data-player-time]');
    var duration = +(player.getAttribute('data-duration') || 393);
    var raf = 0;
    var last = 0;
    var clock = function (sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
    var start = parseFloat(player.getAttribute('data-start') || getComputedStyle(waves[0]).getPropertyValue('--played')) || 0;
    playerState = {
      pos: start / 100,
      paint: function () {
        var p = playerState.pos;
        var pct = (p * 100).toFixed(2) + '%';
        player.style.setProperty('--played', pct);
        lanes.forEach(function (lane) {
          lane.el.style.setProperty('--played', pct);
          var n = Math.round(p * lane.bars.length);
          if (n === lane.n) return;
          // меняем классы только у столбиков, которые перешли границу
          var from = lane.n < 0 ? 0 : Math.min(n, lane.n);
          var to = lane.n < 0 ? lane.bars.length : Math.max(n, lane.n);
          for (var i = from; i < to; i++) lane.bars[i].classList.toggle('is-played', i < n);
          lane.n = n;
        });
        heads.forEach(function (h) { h.style.left = pct; });
        if (time) time.textContent = clock(p * duration);
        follow(p * 100);
      }
    };
    // Реплики с отметкой времени (data-at в % записи) — подсвечиваем текущую и ведём к ней транскрипт
    var timeline = $all('.transcript__body .turn').map(function (t) {
      var chip = t.querySelector('.play-chip[data-at]');
      return chip ? { t: t, at: parseFloat(chip.getAttribute('data-at')) } : null;
    }).filter(Boolean);
    var current = null;
    function follow(pct) {
      var hit = null;
      for (var i = 0; i < timeline.length; i++) { if (timeline[i].at <= pct + 0.05) hit = timeline[i]; else break; }
      if (!hit || hit.t === current) return;
      if (current) current.classList.remove('is-playing');
      current = hit.t;
      current.classList.add('is-playing');
      if (player.classList.contains('is-playing')) {
        var box = current.closest('.transcript__body');
        if (box) box.scrollTo({ top: Math.max(0, current.offsetTop - box.clientHeight / 2 + current.offsetHeight / 2), behavior: reduce ? 'auto' : 'smooth' });
      }
    }
    var speedSel = player.querySelector('select');
    var rate = function () { return speedSel ? parseFloat(String(speedSel.value).replace(',', '.')) || 1 : 1; };
    var tick = function (now) {
      raf = 0;
      if (!player.classList.contains('is-playing')) return;
      var dt = last ? (now - last) / 1000 : 0;
      last = now;
      playerState.pos = Math.min(1, playerState.pos + (dt * rate()) / duration);
      playerState.paint();
      if (playerState.pos >= 1) { player.classList.remove('is-playing'); return; }
      raf = requestAnimationFrame(tick);
    };
    player.querySelector('.player__play').addEventListener('click', function () {
      player.classList.toggle('is-playing');
      last = 0;
      if (player.classList.contains('is-playing') && !raf) raf = requestAnimationFrame(tick);
    });
    $all('.wave, .seekbar', player).forEach(function (area) {
      area.addEventListener('click', function (e) {
        if (e.target.closest('.wave__marker, .audio__pin')) return;
        var r = area.getBoundingClientRect();
        playerState.pos = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        playerState.paint();
      });
    });
    playerState.paint();
  }

  /* ---------- Начальная позиция: строка с data-autofocus — в центре своего списка ---------- */
  function initAutofocus() {
    var t = document.querySelector('[data-autofocus]');
    if (!t) return;
    var box = t.closest('.transcript__body');
    if (!box) return;
    // строка — в верхней трети списка, чтобы следующие за ней реплики фрагмента тоже были видны
    requestAnimationFrame(function () { box.scrollTop = Math.max(0, t.offsetTop - Math.min(box.clientHeight / 3, 140)); });
  }

  /* ---------- Уведомления: <button data-toast="Текст"> ---------- */
  function toast(text, kind) {
    var host = document.querySelector('.toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toasts';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'bad' ? ' toast--bad' : '');
    el.innerHTML = '<svg class="icon"><use href="#' + (kind === 'bad' ? 'i-x-circle' : 'i-check-circle') + '"/></svg><span class="toast__text"></span>';
    el.querySelector('.toast__text').textContent = text;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () { el.remove(); }, 200);
    }, 3400);
  }
  function initToasts() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-toast]');
      if (!btn) return;
      e.preventDefault();
      toast(btn.getAttribute('data-toast'), btn.getAttribute('data-toast-kind'));
      if (btn.getAttribute('data-toast-kind') !== 'bad') {
        var r = btn.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2);
      }
      var modal = btn.closest('.modal');
      if (modal) modal.classList.remove('is-open');
    });
  }


  /* ---------- Лучи по рамке крутятся только на экране ---------- */
  function initBeams() {
    var beams = $all('.beam');
    if (!('IntersectionObserver' in window)) { beams.forEach(function (b) { b.classList.add('in-view'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle('in-view', en.isIntersecting); });
    });
    beams.forEach(function (b) { io.observe(b); });
  }

  /* ---------- Odometer (React Bits Counter): цифры прокручиваются барабаном ---------- */
  function initOdometer() {
    $all('[data-odometer]').forEach(function (el) {
      var text = el.textContent.trim();
      var digits = text.replace(/\D/g, '');
      var fromDigits = String(el.getAttribute('data-from') || '').replace(/\D/g, '');
      el.setAttribute('aria-label', text);
      el.classList.add('odo');
      if (el.hasAttribute('data-delay')) el.style.setProperty('--odo-delay', el.getAttribute('data-delay') + 'ms');
      var html = '';
      var k = 0;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (/\d/.test(ch)) {
          var fromD = fromDigits ? +(fromDigits[fromDigits.length - (digits.length - k)] || 0) : 0;
          var strip = '';
          for (var n = 0; n < 20; n++) strip += '<span>' + (n % 10) + '</span>';
          html += '<span class="odo__col" aria-hidden="true"><span class="odo__strip" style="--d:' + fromD + ';--k:' + k + '" data-target="' + (10 + +ch) + '">' + strip + '</span></span>';
          k++;
        } else {
          html += '<span class="odo__sym" aria-hidden="true">' + (ch === ' ' ? '&nbsp;' : ch) + '</span>';
        }
      }
      el.innerHTML = html;
      var strips = $all('.odo__strip', el);
      var go = function () { strips.forEach(function (st) { st.style.setProperty('--d', st.getAttribute('data-target')); }); };
      if (reduce) { go(); return; }
      // Сначала даём браузеру отрисовать барабан в исходном положении, затем запускаем прокрутку.
      var start = function () { setTimeout(go, 60); };
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) start();
      else onVisible(el, start);
    });
  }

  /* ---------- Повтор диалога: реплики по очереди, оператор «печатает» ---------- */
  function initReplay() {
    $all('[data-replay]').forEach(function (btn) {
      var body = document.querySelector('.transcript__body');
      if (!body) return;
      var label = btn.querySelector('[data-replay-label]');
      var timer = 0;
      var running = false;
      var stop = function () {
        running = false;
        clearTimeout(timer);
        $all('.typing', body).forEach(function (t) { t.remove(); });
        $all('.turn.is-hidden', body).forEach(function (t) { t.classList.remove('is-hidden'); });
        btn.setAttribute('aria-pressed', 'false');
        if (label) label.textContent = 'Повторить диалог';
      };
      btn.addEventListener('click', function () {
        if (running) { stop(); return; }
        running = true;
        btn.setAttribute('aria-pressed', 'true');
        if (label) label.textContent = 'Остановить';
        var turns = $all('.turn', body);
        turns.forEach(function (t) { t.classList.add('is-hidden'); t.classList.remove('is-replay-in'); });
        body.scrollTop = 0;
        var i = 0;
        var toBottom = function () { body.scrollTo({ top: body.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }); };
        (function next() {
          if (!running) return;
          if (i >= turns.length) { stop(); return; }
          var t = turns[i++];
          var show = function () {
            t.classList.remove('is-hidden');
            t.classList.add('is-replay-in');
            toBottom();
            var gap = t.classList.contains('turn--system') ? 160 : t.classList.contains('turn--bot') ? 240 : 420;
            timer = setTimeout(next, reduce ? 0 : gap);
          };
          if (t.classList.contains('turn--operator') && !reduce) {
            var typing = document.createElement('li');
            typing.className = 'typing';
            typing.setAttribute('aria-hidden', 'true');
            typing.innerHTML = '<i></i><i></i><i></i>';
            t.parentNode.insertBefore(typing, t);
            toBottom();
            timer = setTimeout(function () { typing.remove(); show(); }, 700);
          } else {
            show();
          }
        })();
      });
    });
  }

  /* ---------- Демо запуска оценки: очередь проходит по одному диалогу ---------- */
  var JOB_ICONS = {
    done: '<svg class="icon"><use href="#i-check-circle"/></svg>',
    error: '<svg class="icon"><use href="#i-x-circle"/></svg>',
    running: '<span class="bars-loader" aria-hidden="true"><i></i><i></i><i></i></span>',
    queued: ''
  };
  function setJob(job, state) {
    job.className = 'job job--' + state;
    job.querySelector('.job__status').innerHTML = JOB_ICONS[state];
    var note = job.querySelector('.job__note');
    var end = job.querySelector('.job__end');
    if (state === 'queued') { note.textContent = 'В очереди'; end.innerHTML = ''; }
    if (state === 'running') { note.textContent = 'Проверяем критерии 01–08…'; end.innerHTML = '<span class="skeleton skeleton--line" style="width:96px;display:block"></span>'; }
    if (state === 'done') {
      note.textContent = 'Готово за ' + (job.getAttribute('data-time') || '0,7') + ' с';
      end.innerHTML = '<span class="score score--' + (job.getAttribute('data-tone') || 'ok') + '"><span class="score__value">' + job.getAttribute('data-score') + '</span></span>';
    }
    if (state === 'error') {
      note.textContent = job.getAttribute('data-error') || 'Ошибка оценки';
      end.innerHTML = '<button class="btn btn--danger btn--sm" type="button"><svg class="icon"><use href="#i-refresh"/></svg>Повторить</button>';
      job.classList.add('shake');
    }
  }
  function initRunDemo() {
    var btn = document.querySelector('[data-run-demo]');
    var list = document.querySelector('[data-run-jobs]');
    if (!btn || !list) return;
    var hud = document.querySelector('[data-run-hud]');
    var q = function (sel) { return hud ? hud.querySelector(sel) : null; };
    var running = false;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (running) return;
      running = true;
      btn.classList.add('is-disabled');
      var jobs = $all('.job', list);
      jobs.forEach(function (j) { setJob(j, 'queued'); j.classList.remove('shake'); });
      var total = jobs.length;
      var done = 0;
      var errors = 0;
      var sum = 0;
      if (q('[data-run-title]')) q('[data-run-title]').textContent = 'Идёт оценка';
      if (q('[data-run-loader]')) q('[data-run-loader]').hidden = false;
      var paint = function () {
        var processed = done + errors;
        if (q('[data-run-count]')) q('[data-run-count]').textContent = processed;
        if (q('.progress__fill')) q('.progress__fill').style.setProperty('--p', (processed / total * 100).toFixed(1) + '%');
        if (q('[data-run-done]')) q('[data-run-done]').textContent = done;
        if (q('[data-run-error]')) q('[data-run-error]').textContent = errors;
        if (q('[data-run-left]')) q('[data-run-left]').textContent = total - processed;
        if (q('[data-run-avg]')) q('[data-run-avg]').textContent = done ? formatNum(Math.round(sum / done * 100) / 100, 2).replace(/,?0+$/, '') : '—';
        if (q('[data-run-eta]')) q('[data-run-eta]').textContent = processed < total ? 'осталось около ' + (total - processed) + ' с' : 'готово';
      };
      paint();
      var i = 0;
      (function next() {
        if (i >= jobs.length) {
          running = false;
          btn.classList.remove('is-disabled');
          if (q('[data-run-title]')) q('[data-run-title]').textContent = 'Оценка завершена';
          if (q('[data-run-loader]')) q('[data-run-loader]').hidden = true;
          toast('Оценено ' + done + ' из ' + total + (errors ? ', ошибок: ' + errors : ''));
          if (hud) { var r = hud.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + 80); }
          return;
        }
        var job = jobs[i++];
        setJob(job, 'running');
        setTimeout(function () {
          var final = job.getAttribute('data-final') || 'done';
          setJob(job, final);
          if (final === 'done') { done++; sum += parseFloat(String(job.getAttribute('data-score')).replace(',', '.')) || 0; } else { errors++; }
          paint();
          next();
        }, reduce ? 60 : 650 + Math.random() * 450);
      })();
    });
  }

  /* ---------- Конструктор: вес критерия меняет полосу распределения сразу ---------- */
  function initWeightDemo() {
    var input = document.querySelector('[data-weight-input]');
    var meter = document.querySelector('.weights-meter');
    if (!input || !meter) return;
    var code = input.getAttribute('data-weight-input');
    var segs = $all('.wseg', meter);
    var seg = segs.filter(function (sg) { return sg.textContent.trim() === code; })[0];
    var sumEl = meter.querySelector('[data-weight-sum]');
    var stateEl = meter.querySelector('[data-weight-state]');
    var share = document.querySelector('[data-weight-share]');
    var rowWeight = document.querySelector('.crit-row.is-selected .crit-row__weight');
    input.addEventListener('input', function () {
      var w = Math.max(0, parseFloat(input.value) || 0);
      if (seg) { seg.setAttribute('data-w', w); seg.style.setProperty('--w', Math.max(w, 0.5)); }
      var total = segs.reduce(function (a, sg) { return a + (parseFloat(sg.getAttribute('data-w')) || 0); }, 0);
      if (sumEl) sumEl.textContent = formatNum(total, 0);
      var ok = Math.abs(total - 100) < 1e-9;
      meter.classList.toggle('is-warn', !ok);
      if (stateEl) stateEl.textContent = ok ? 'норма' : 'итог нормируется к 100';
      if (share) share.textContent = (total ? formatNum(Math.round(w / total * 1000) / 10, 1).replace(/,0$/, '') : '0') + ' из 100';
      if (rowWeight) rowWeight.textContent = formatNum(w, 0);
    });
  }

  /* ---------- Апелляция: предпросмотр итога меняется вместе с решением ---------- */
  function tween(el, to, decimals) {
    var from = parseFloat(String(el.textContent).replace(/\s/g, '').replace(',', '.')) || 0;
    var start = performance.now();
    var dur = reduce ? 0 : 600;
    (function step(now) {
      var t = dur ? Math.min(1, (now - start) / dur) : 1;
      var e = 1 - Math.pow(1 - t, 3);
      var v = from + (to - from) * e;
      el.textContent = formatNum(Math.round(v * 100) / 100, t < 1 ? decimals : (Math.round(to * 100) % 100 ? (Math.round(to * 100) % 10 ? 2 : 1) : 0));
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }
  function initDecisionDemo() {
    var form = document.querySelector('[data-decision]');
    if (!form) return;
    var base = parseFloat(form.getAttribute('data-base')) || 0;
    var select = form.querySelector('select');
    var deltaEl = form.querySelector('[data-delta]');
    var finalEl = form.querySelector('[data-final]');
    var update = function () {
      var checked = form.querySelector('input[name="decision"]:checked');
      var change = checked && checked.value === 'change';
      select.disabled = !change;
      var delta = change ? parseFloat(select.options[select.selectedIndex].getAttribute('data-delta') || '0') : 0;
      if (deltaEl) deltaEl.textContent = (delta > 0 ? '+' : delta < 0 ? '−' : '±') + formatNum(Math.abs(delta), Math.abs(delta) % 1 ? 2 : 0);
      if (finalEl) tween(finalEl, base + delta, 2);
    };
    form.addEventListener('change', update);
  }

  /* ---------- Подсказки: одна всплывашка для всех [data-tip] ---------- */
  function initTips() {
    var tip = null;
    var show = function (el) {
      var text = el.getAttribute('data-tip');
      if (!text) return;
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'tip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
      }
      tip.textContent = text;
      tip.style.display = 'block';
      var r = el.getBoundingClientRect();
      var w = tip.offsetWidth;
      var h = tip.offsetHeight;
      var below = r.top - h - 10 < 8;
      tip.classList.toggle('tip--below', below);
      tip.style.left = Math.min(window.innerWidth - w / 2 - 8, Math.max(w / 2 + 8, r.left + r.width / 2)) + 'px';
      tip.style.top = (below ? r.bottom + 10 : r.top - h - 10) + 'px';
      tip.style.animation = 'none';
      void tip.offsetWidth;
      tip.style.animation = '';
    };
    var hide = function () { if (tip) tip.style.display = 'none'; };
    document.addEventListener('pointerover', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
    document.addEventListener('pointerout', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el && !el.contains(e.relatedTarget)) hide(); });
    document.addEventListener('focusin', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, { passive: true });
  }

  /* ---------- Быстрый поиск: «/» или Ctrl+K ---------- */
  function initPalette() {
    var pal = document.getElementById('palette');
    if (!pal) return;
    var input = pal.querySelector('[data-palette-input]');
    var list = pal.querySelector('.palette__list');
    var items = $all('.palette__item', pal);
    var empty = pal.querySelector('.palette__empty');
    var active = 0;
    var shown = function () { return items.filter(function (it) { return !it.hidden; }); };
    var setActive = function (n) {
      var v = shown();
      items.forEach(function (it) { it.classList.remove('is-active'); });
      if (!v.length) return;
      active = (n + v.length) % v.length;
      v[active].classList.add('is-active');
      v[active].scrollIntoView({ block: 'nearest' });
    };
    var filter = function () {
      var q = input.value.trim().toLowerCase();
      items.forEach(function (it, i) {
        var hay = (it.textContent + ' ' + (it.getAttribute('data-keywords') || '')).toLowerCase();
        it.hidden = !!q && hay.indexOf(q) === -1;
        it.style.setProperty('--i', i);
      });
      var group = null;
      var groupHasItems = false;
      Array.prototype.forEach.call(list.children, function (node) {
        if (node.classList.contains('palette__group')) {
          if (group) group.hidden = !groupHasItems;
          group = node;
          groupHasItems = false;
        } else if (!node.hidden) {
          groupHasItems = true;
        }
      });
      if (group) group.hidden = !groupHasItems;
      empty.hidden = shown().length > 0;
      setActive(0);
    };
    var open = function () {
      pal.classList.add('is-open');
      input.value = '';
      filter();
      setTimeout(function () { input.focus(); }, 30);
    };
    document.addEventListener('keydown', function (e) {
      var el = document.activeElement;
      var typing = el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);
      if ((e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(); return; }
      if (e.key === '/' && !typing) { e.preventDefault(); open(); return; }
      if (!pal.classList.contains('is-open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { var v = shown()[active]; if (v) { e.preventDefault(); v.click(); } }
    });
    input.addEventListener('input', filter);
    items.forEach(function (it) { it.addEventListener('pointermove', function () { var v = shown(); var n = v.indexOf(it); if (n >= 0 && n !== active) setActive(n); }); });
    $all('[data-palette-open]').forEach(function (trigger) {
      trigger.addEventListener('focus', function () { trigger.blur(); open(); });
      trigger.addEventListener('click', function (e) { e.preventDefault(); open(); });
    });
  }

  function boot() {
    initTheme();
    initRailPin();
    initSplit();
    initCount();
    initDecrypt();
    initSpotlight();
    initMagnet();
    initTilt();
    initSparks();
    initThumbs();
    initToggles();
    initEvidenceLinks();
    initModals();
    initPlayer();
    initToasts();
    initBeams();
    initOdometer();
    initReplay();
    initRunDemo();
    initWeightDemo();
    initDecisionDemo();
    initTips();
    initPalette();
    initAutofocus();
  }

  window.CQAfx = {
    toast: toast,
    focusTurn: focusTurn,
    refreshThumbs: refreshThumbs,
    burst: function (x, y) { burst(x, y); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
