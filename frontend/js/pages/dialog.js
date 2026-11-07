/* Карточка диалога (чат и звонок): транскрипт, итог и критерии из /api/conversations и /api/evaluations. Апелляция уходит в /api/appeals. */
(function () {
  const CQA = window.CQA, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const id = new URLSearchParams(location.search).get("id");
  const E = CQA.esc, N = CQA.num;
  const ICON = (n, c) => `<svg class="icon${c ? " " + c : ""}"><use href="#i-${n}"/></svg>`;
  const WHO = { client: ["Клиент", "user", ""], bot: ["Бот", "bot", " avatar--bot"], operator: ["Оператор", "headset", " avatar--operator"] };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  let conv, ev, checklist, crits;

  const stamp = (t) => (t === null || t === undefined ? "" : CQA.mmss(t));
  const turnNo = (uid) => conv.transcript.findIndex((u) => u.id === uid) + 1;
  const refs = (text) => E(text).replace(/#(\d+)/g, '<a class="turn-ref" href="#t-$1">#$1</a>');

  function marksFor() {
    const m = {};
    (ev ? ev.results : []).forEach((r) => (r.evidence || []).forEach((e) => {
      const n = turnNo(e.id); if (!n) return;
      const kind = r.is_critical ? (r.final_answer === "yes" ? "violation" : "context") : r.final_answer === "no" ? "violation" : r.final_answer === "NA" ? "context" : "support";
      (m[n] = m[n] || []).push(`<a class="mark mark--${kind}" href="#c-${r.criterion_id.slice(1)}" title="${E(r.title)}">${r.criterion_id.slice(1)}</a>`);
    }));
    return m;
  }

  // Подсказка «как надо было»: только пока критерий выполнен не полностью по итоговому ответу (после апелляции с «Да» исчезает).
  const coachOf = (r) => (r.suggestion && !r.is_critical && ["x", "m"].includes(CQA.barClass(r)) ? r.suggestion : "");
  const coachCount = () => (ev && ev.status === "done" ? ev.results.filter((r) => coachOf(r)).length : 0);
  function coachAnchors() {
    const out = {}, lastOp = conv.transcript.map((u, i) => (u.speaker === "operator" ? i + 1 : 0)).filter(Boolean).pop() || conv.transcript.length;
    (ev && ev.status === "done" ? ev.results : []).forEach((r) => {
      if (!coachOf(r)) return;
      const ev1 = Math.max(0, ...(r.evidence || []).map((e) => turnNo(e.id)));
      const n = ev1 || (r.checked_range ? turnNo(r.checked_range.to) : 0) || lastOp;
      (out[n] = out[n] || []).push(r);
    });
    return out;
  }
  const coachHtml = (r) => `<li class="coach" id="coach-${r.criterion_id}" role="note" aria-label="Подсказка ИИ-коуча: как надо было сказать"><div class="coach__box"><div class="coach__head"><span class="coach__badge">✨ ИИ-коуч</span> Как надо было сказать · ${E(r.title)}</div><p class="coach__text">«${E(r.suggestion)}»</p></div></li>`;

  function transcriptHtml() {
    const marks = marksFor(), coach = coachAnchors();
    return conv.transcript.map((u, i) => {
      const n = i + 1, time = stamp(u.t);
      const after = (coach[n] || []).map(coachHtml).join("");
      if (u.speaker === "system") return `<li class="turn turn--system" id="t-${n}" style="--i:${i}"><span class="turn__sys">${ICON("headset")}${E(u.text)}<time>${time}</time></span></li>` + after;
      const [who, icon, ac] = WHO[u.speaker] || ["Реплика", "user", ""];
      const clamp = u.speaker === "bot" && u.text.length > 220 ? " is-clamped" : "";
      return `<li class="turn turn--${u.speaker}" id="t-${n}" style="--i:${i}"><span class="avatar${ac}">${ICON(icon)}</span><div class="turn__body"><div class="turn__meta"><a class="turn__no" href="#t-${n}">#${n}</a><span class="turn__who">${who}</span><time class="turn__time">${time}</time>${CQA.isCall(conv) && u.t !== null && u.t !== undefined ? `<a class="play-chip" href="#t-${n}" data-at="${u.t}" aria-label="Слушать с ${time}">${ICON("play")}</a>` : ""}</div><p class="turn__text${clamp}">${E(u.text)}</p>${marks[n] ? `<div class="turn__marks">${marks[n].join("")}</div>` : ""}</div></li>` + after;
    }).join("");
  }

  const crit = (r) => crits.find((c) => c.id === r.criterion_id) || {};
  const scaleMax = (r) => Math.max(0, ...((crit(r).steps || []).map((s) => s.value)));
  function verdictText(r) {
    if (r.is_critical) return r.final_answer === "yes" ? ["verdict--no", "Выявлено"] : ["verdict--yes", "Не выявлено"];
    if (r.final_answer === "NA") return ["verdict--na", "N/A"];
    if (r.type === "scale") { const ratio = r.effective_weight ? r.points / r.effective_weight : 1; return [ratio >= 0.999 ? "verdict--yes" : ratio <= 0.001 ? "verdict--no" : "verdict--mid", `${r.final_answer} из ${scaleMax(r)}`]; }
    return r.final_answer === "yes" ? ["verdict--yes", "Да"] : ["verdict--no", "Нет"];
  }
  function critClass(r) {
    if (r.is_critical) return r.final_answer === "yes" ? "no" : "yes";
    const c = CQA.barClass(r);
    return c === "n" ? "na" : c === "x" ? "no" : c === "m" ? "mid" : "yes";
  }

  function critHtml(r, i) {
    const code = r.criterion_id.slice(1), c = crit(r), appeals = ev.appeals.filter((a) => a.criterion_id === r.criterion_id);
    const changed = appeals.find((a) => a.decision === "changed");
    let [vcls, vtext] = verdictText(r);
    let verdict = `<span class="verdict ${vcls}">${E(vtext)}</span>`;
    if (changed) {
      const was = r.type === "scale" ? `${r.ai_answer}` : CQA.ANSWER[r.ai_answer] || r.ai_answer;
      verdict = `<span class="row" style="gap:4px"><span class="verdict verdict--no is-struck">${E(String(was))}</span>${verdict}</span>`;
    }
    const pts = r.is_critical ? "флаг без баллов" : r.final_answer === "NA" ? `вес ${N(r.base_weight)} перераспределён` : `<b>${N(r.points)}</b> из ${N(r.effective_weight)}&ensp;вес ${N(r.base_weight)}`;
    const kind = r.is_critical ? "violation" : r.final_answer === "no" ? "violation" : "support";
    const evidence = (r.evidence || []).map((e) => { const n = turnNo(e.id); return `<a class="evidence__item evidence__item--${kind}" href="#t-${n}"><span class="turn-ref">#${n}</span><span><span class="evidence__quote">${E(e.quote)}</span>${e.verified === false ? '<span class="evidence__note">цитата не найдена в тексте</span>' : ""}</span></a>`; }).join("");
    const box = appeals.map((a) => `<div class="appeal-box"><div class="appeal-box__head">${ICON("scale", "icon--sm")}Апелляция оператора<span class="tiny">${dt(a.created_at)}</span></div><p>«${E(a.comment)}»</p>${a.status === "resolved" ? `<div class="appeal-box__head appeal-box__head--ok">${ICON("check-circle", "icon--sm")}Проверяющий: ${a.decision === "changed" ? "оценка изменена" : "оценка подтверждена"}<span class="tiny">${dt(a.decided_at)}</span></div><p>${E(a.decision_reason || "")}</p>` : `<div class="appeal-box__head">${ICON("clock", "icon--sm")}Ждёт решения проверяющего</div>`}</div>`).join("");
    const coach = coachOf(r) ? `<div class="crit__coach"><b><span class="coach__badge">✨ ИИ-коуч</span> Как надо было сказать</b><span>«${E(r.suggestion)}»</span><button class="btn btn--ghost btn--sm" type="button" data-coach="${r.criterion_id}">Показать в разговоре</button></div>` : "";
    const naBox = r.final_answer === "NA" && c.na_condition ? `<div class="crit__na">${ICON("info", "icon--sm")}<span><b>Условие N/A:</b> ${E(c.na_condition)}</span></div>` : "";
    const foot = r.is_critical || r.final_answer === "NA" || !ev.id ? "" : `<div class="crit__foot"><span class="spacer"></span><a class="btn btn--ghost btn--sm" href="#appeal-modal" data-crit="${r.criterion_id}">${ICON("scale")}Оспорить</a></div>`;
    return `<article class="card spot crit crit--${critClass(r)}" id="c-${code}"><span class="crit__bar" aria-hidden="true"></span>
      <div class="crit__head"><span class="crit__code">${code}</span><div><h3 class="crit__title">${E(r.title)}</h3><p class="crit__rule">${E((c.instruction || "").split(". ")[0])}</p></div><div class="crit__verdict">${verdict}<span class="crit__points">${pts}</span></div></div>
      ${naBox}<p class="crit__text">${refs(r.reason || "")}</p>${coach}${evidence ? `<div class="evidence">${evidence}</div>` : ""}${box}${foot}</article>`;
  }


  // Карточка ИИ-коуча над оценкой: сводка потерь и «было → надо было». Готовые данные, новых запросов к ИИ нет.
  function coachCard() {
    const rs = ev.results.filter((r) => !r.is_critical && r.final_answer !== "NA");
    const loss = (r) => Math.max(0, r.effective_weight - r.points);
    const lossy = rs.filter((r) => loss(r) > 0.005).sort((a, b) => loss(b) - loss(a)), tips = ev.results.filter(coachOf);
    const total = lossy.reduce((a, r) => a + loss(r), 0);
    const opQuote = (r) => { const e = (r.evidence || []).find((x) => (conv.transcript.find((u) => u.id === x.id) || {}).speaker === "operator") || (r.evidence || [])[0]; return e ? e.quote : ""; };
    let say, body;
    if (!lossy.length) { say = "Разобрал разговор: замечаний нет, оператор справился со всеми применимыми критериями."; body = ""; }
    else {
      say = `Разобрал разговор: потеряно <b>${N(total)}</b> из 100 баллов по ${lossy.length} ${CQA.plural(lossy.length, "критерию", "критериям", "критериям")}. Больше всего баллов ушло на «${E(lossy[0].title)}» (−${N(loss(lossy[0]))}).`;
      body = tips.length ? tips.map((r) => `<div class="coachcard__tip"><div class="coachcard__tiphead"><b>${r.criterion_id.slice(1)} ${E(r.title)}</b><span class="tag tag--bad">−${N(loss(r))}</span></div>${opQuote(r) ? `<p class="coachcard__was"><span>Было</span>«${E(opQuote(r))}»</p>` : ""}<p class="coachcard__should"><span>Надо было</span>«${E(r.suggestion)}»</p><button class="btn btn--ghost btn--sm" type="button" data-coach="${r.criterion_id}">Показать в разговоре</button></div>`).join("")
        : `<p class="coachcard__none">Готовых фраз для этого диалога нет: он оценён без подсказок. <a href="run.html?ids=${encodeURIComponent(conv.conversation_id)}">Переоценить с ИИ-коучем</a></p>`;
    }
    return `<section class="card spot coachcard" aria-label="ИИ-коуч" style="--i:0"><div class="coachcard__head"><span class="coachcard__avatar" aria-hidden="true">${ICON("sparkles")}</span><div><p class="coachcard__name">ИИ-коуч</p><p class="coachcard__role">помощник оператора</p></div></div><p class="coachcard__say">${say}</p>${body}</section>`;
  }

  function panelHtml() {
    if (!ev) return `<section class="card scorecard" style="--i:0"><p class="scorecard__label">Оценки пока нет</p><p class="muted">Запустите оценку на странице «Новая оценка».</p><a class="btn btn--primary" href="run.html?ids=${encodeURIComponent(id)}">Оценить</a></section>`;
    if (ev.status !== "done") return `<section class="card scorecard" style="--i:0"><p class="scorecard__label">Нужна проверка</p><p class="muted">${E(ev.error || "Диалог не оценён автоматически.")}</p></section>`;
    const decided = ev.appeals.filter((a) => a.status === "resolved" && a.decision === "changed").length > 0;
    const open = ev.appeals.filter((a) => a.status === "open").length;
    const rs = ev.results, crits7 = rs.filter((r) => !r.is_critical);
    const stripes = crits7.map((r, i) => {
      const code = r.criterion_id.slice(1), ratio = r.effective_weight ? r.points / r.effective_weight : 0;
      if (r.final_answer === "NA") return `<a class="stripe rise is-na" href="#c-${code}" style="--i:${i}" data-tip="${code} ${E(r.title)}: N/A, вес ${N(r.base_weight)} перераспределён"><span class="stripe__code">${code}</span><span class="stripe__pts">N/A</span></a>`;
      const cls = ratio >= 0.999 ? "" : ratio <= 0.001 ? " is-bad" : " is-mid";
      const ch = ev.appeals.some((a) => a.criterion_id === r.criterion_id && a.decision === "changed") ? " is-changed" : "";
      return `<a class="stripe rise${cls}${ch}" href="#c-${code}" style="--w:${r.effective_weight};--f:${ratio.toFixed(3)};--i:${i}" data-tip="${code} ${E(r.title)}: ${N(r.points)} из ${N(r.effective_weight)}"><span class="stripe__code">${code}</span><span class="stripe__fill"></span><span class="stripe__pts">${N(r.points)}</span></a>`;
    }).join("");
    const na = crits7.filter((r) => r.final_answer === "NA"), naW = na.reduce((s, r) => s + r.base_weight, 0);
    const bySection = [];
    rs.forEach((r) => { let s = bySection.find((x) => x.name === r.section); if (!s) bySection.push((s = { name: r.section, rows: [] })); s.rows.push(r); });
    const sectionsHtml = bySection.map((s, k) => {
      const got = s.rows.reduce((a, r) => a + r.points, 0), max = s.rows.reduce((a, r) => a + r.effective_weight, 0);
      const crit8 = s.rows.some((r) => r.is_critical);
      return `<section class="section" style="--i:${k + 1}"><div class="section__head"><h2 class="section__title">${E(s.name)}</h2><span class="section__score">${crit8 ? "в итог не входит" : `<b>${N(got)}</b> из ${N(max)}`}</span></div>${s.rows.map(critHtml).join("")}</section>`;
    }).join("");
    const verdict = ev.final_critical_flag ? '<span class="verdict verdict--no stamp">Грубая ошибка</span>' : open ? '<span class="verdict verdict--amber stamp">Апелляция</span>' : decided ? '<span class="verdict verdict--amber stamp">Решение принято</span>' : "";
    const recalc = ev.ai_total !== ev.final_total ? `<div class="recalc">${ICON("history")}Исходная оценка <s>${N(ev.ai_total)}</s>${ICON("arrow-right", "recalc__arrow")}после решений проверяющего <b>${N(ev.final_total)}</b></div>` : "";
    const clean = ev.final_critical_flag ? `<div class="clean" style="color:var(--bad)">${ICON("flag")}Выявлена грубая ошибка, итог ограничен</div>` : `<div class="clean">${ICON("shield")}Грубых ошибок не выявлено</div>`;
    const timeline = [`<li class="timeline__item" style="--i:0"><span class="timeline__dot">${ICON("cpu")}</span><div><p class="timeline__title">Исходная оценка — ${N(ev.ai_total)}</p><p class="timeline__text">${dt(ev.created_at)}, ${E(ev.model)}, ${E(ev.checklist_name)} v${ev.checklist_version}</p></div></li>`];
    ev.appeals.forEach((a) => {
      timeline.push(`<li class="timeline__item"><span class="timeline__dot timeline__dot--amber">${ICON("scale")}</span><div><p class="timeline__title">Апелляция по критерию ${a.criterion_id.slice(1)}</p><p class="timeline__text">${dt(a.created_at)}, ${E(a.created_by || "оператор")}</p></div></li>`);
      if (a.status === "resolved") timeline.push(`<li class="timeline__item"><span class="timeline__dot timeline__dot--amber">${ICON("shield")}</span><div><p class="timeline__title">Решение: ${a.decision === "changed" ? "оценка изменена" : "оценка подтверждена"}</p><p class="timeline__text">${dt(a.decided_at)}, ${E(a.decided_by || "проверяющий")}</p></div></li>`);
    });
    if (ev.appeals.length) timeline.push(`<li class="timeline__item"><span class="timeline__dot timeline__dot--final">${ICON("check")}</span><div><p class="timeline__title">Финальный итог — ${N(ev.final_total)}</p></div></li>`);
    return coachCard() + `<section class="card spot scorecard beam" aria-label="Итог" style="--i:0"><span class="scorecard__glow" aria-hidden="true"></span>
      <div class="scorecard__top"><div><p class="scorecard__label">${decided ? "Итог после апелляции" : "Итог"}</p><p class="score-giant"><span class="shiny">${N(ev.final_total)}</span><small>из 100</small></p></div>
      <div class="scorecard__aside">${verdict}<span class="scorecard__note">Оценено ${dt(ev.created_at)}, ${E(ev.model)}</span></div></div>
      <div class="stripes"><div class="stripes__row">${stripes}</div><div class="stripes__legend"><span><i style="background:var(--signal)"></i>ширина — вес после перераспределения</span>${na.length ? `<span><i style="background:repeating-linear-gradient(135deg,var(--na) 0 2px,transparent 2px 4px)"></i>N/A: вес ${N(naW)} отдан остальным</span>` : ""}<span><i style="box-shadow:inset 0 0 0 2px var(--amber)"></i>изменено по апелляции</span></div></div>
      ${recalc}${clean}</section>${sectionsHtml}
      <section class="card spot" aria-label="История оценки" style="--i:9"><div class="card__head">${ICON("history")}<span class="card__title">История оценки</span></div><div class="card__body"><ol class="timeline">${timeline.join("")}</ol></div></section>`;
  }

  function fillModal() {
    const sel = $("#ap-crit");
    const items = (ev ? ev.results : []).filter((r) => !r.is_critical && r.final_answer !== "NA");
    sel.innerHTML = items.map((r) => `<option value="${r.criterion_id}">${r.criterion_id.slice(1)} ${E(r.title)} — ${E(verdictText(r)[1])}</option>`).join("");
    $(".modal__head p.muted").textContent = `Диалог ${id}. Проверяющий увидит оценку и ваш комментарий.`;
    const box = $("#appeal-modal .box"), field = $$("#appeal-modal .field").pop();
    const show = () => {
      const r = items.find((x) => x.criterion_id === sel.value); if (!r) return;
      const [vc, vt] = verdictText(r);
      box.innerHTML = `<div class="row"><span class="verdict ${vc}">${E(vt)}</span><span class="muted small">${N(r.points)} из ${N(r.effective_weight)} баллов</span></div><p class="small" style="color:var(--ink-2)">${refs(r.reason || "")}</p>`;
    };
    sel.onchange = show; show();
    if (field) field.remove();
    const send = $("#appeal-modal .btn--primary");
    send.removeAttribute("data-toast");
    send.onclick = async () => {
      const comment = $("#ap-comment").value.trim();
      if (!comment) { $("#ap-comment").focus(); return; }
      send.disabled = true;
      try {
        await CQA.api.post("/api/appeals", { evaluation_id: ev.id, criterion_id: sel.value, comment, created_by: "Оператор" });
        location.hash = ""; location.reload();
      } catch (e) { send.disabled = false; alert(e.message); }
    };
    $$("a[data-crit]").forEach((a) => a.addEventListener("click", () => { sel.value = a.dataset.crit; show(); }));
  }


  // Плеер звонка: настоящий <audio> из /api/audio, метки на дорожке — реплики-доказательства.
  function setupPlayer() {
    const old = $(".player"); if (!old) return;
    if (!conv.audio_path) { old.remove(); return; }
    const total = conv.duration || 1;
    let seed = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const bars = Array.from({ length: 96 }, (_, i) => { seed = (seed * 1664525 + 1013904223) >>> 0; return `<i style="--h:${18 + Math.round(((seed >>> 8) % 1000) / 1000 * 70)};--i:${i}"></i>`; }).join("");
    const marks = [];
    (ev ? ev.results : []).forEach((r) => (r.evidence || []).forEach((e) => {
      const n = turnNo(e.id), u = conv.transcript[n - 1]; if (!n || !u || u.t === null) return;
      const bad = r.is_critical ? r.final_answer === "yes" : r.final_answer === "no";
      marks.push(`<a class="wave__marker${bad ? " wave__marker--bad" : ""}" href="#t-${n}" data-at="${u.t}" style="--at:${(u.t / total * 100).toFixed(1)}%" title="#${n} — ${r.criterion_id.slice(1)} ${E(r.title)}"></a>`);
    }));
    const el = document.createElement("div");
    el.className = "player"; el.setAttribute("aria-label", "Запись разговора");
    el.innerHTML = `<div class="player__row"><button class="player__play" type="button" aria-label="Воспроизвести или поставить на паузу"><svg class="icon i-play"><use href="#i-play"/></svg><svg class="icon i-pause"><use href="#i-pause"/></svg></button>
      <div class="wave" style="--played:0%" role="slider" tabindex="0" aria-label="Позиция записи" aria-valuemin="0" aria-valuemax="${Math.round(total)}" aria-valuenow="0">${bars}<span class="wave__head" aria-hidden="true"></span>${marks.join("")}</div>
      <span class="player__time"><b data-player-time>0:00</b><span> / ${CQA.mmss(total)}</span></span></div>
      <div class="player__meta"><span>Точки на дорожке — реплики-доказательства. Нажмите на значок у реплики, чтобы услышать её.</span><label class="sr-only" for="speed">Скорость</label>
      <select class="select" id="speed"><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select>
      <a href="${E(conv.audio_path)}" target="_blank" rel="noopener" class="small">${ICON("external", "icon--sm")}Открыть запись в новой вкладке</a></div>
      <audio preload="metadata" src="${E(conv.audio_path)}"></audio>`;
    old.replaceWith(el);
    const audio = $("audio", el), wave = $(".wave", el), barEls = $$("i", wave), time = $("[data-player-time]", el);
    const len = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : total);
    const turns = conv.transcript.map((u, i) => [u.t, i + 1]).filter(([t]) => t !== null && t !== undefined);
    let last = -1;
    const paint = () => {
      const t = audio.currentTime, p = Math.min(1, t / len());
      wave.style.setProperty("--played", (p * 100).toFixed(2) + "%");
      barEls.forEach((b, i) => b.classList.toggle("is-played", i / barEls.length < p));
      time.textContent = CQA.mmss(t); wave.setAttribute("aria-valuenow", Math.round(t));
      let now = 0; turns.forEach(([tt, n]) => { if (tt <= t + 0.2) now = n; });
      if (now !== last) { last = now; $$(".turn.is-playing").forEach((x) => x.classList.remove("is-playing")); const li = $("#t-" + now); if (li && !audio.paused) li.classList.add("is-playing"); }
    };
    const seek = (t) => { audio.currentTime = Math.max(0, Math.min(t, len())); paint(); };
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("play", () => el.classList.add("is-playing"));
    audio.addEventListener("pause", () => { el.classList.remove("is-playing"); $$(".turn.is-playing").forEach((x) => x.classList.remove("is-playing")); });
    audio.addEventListener("ended", () => el.classList.remove("is-playing"));
    $(".player__play", el).addEventListener("click", () => (audio.paused ? audio.play().catch((e) => CQA.fail($(".page"), e)) : audio.pause()));
    wave.addEventListener("click", (e) => { if (e.target.closest(".wave__marker")) return; const r = wave.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * len()); });
    wave.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") seek(audio.currentTime + 5); if (e.key === "ArrowLeft") seek(audio.currentTime - 5); if (e.key === " ") { e.preventDefault(); $(".player__play", el).click(); } });
    $$(".wave__marker", el).forEach((m) => m.addEventListener("click", () => seek(+m.dataset.at)));
    $("#speed", el).addEventListener("change", (e) => { audio.playbackRate = +e.target.value; });
    $(".transcript__body").addEventListener("click", (e) => { const c = e.target.closest(".play-chip"); if (!c) return; e.preventDefault(); seek(+c.dataset.at); audio.play().catch(() => {}); });
  }

  async function init() {
    if (!id) { CQA.fail($(".page"), new Error("Не указан диалог: откройте его из списка")); return; }
    try {
      conv = await CQA.api.conversation(id);
      const evs = conv.evaluations;
      const pick = evs.find((e) => e.status !== "queued" && e.status !== "running") || evs[0];
      ev = pick ? await CQA.api.evaluation(pick.id) : null;
      checklist = ev ? await CQA.api.get(`/api/checklists/${ev.checklist_id}/versions/${ev.checklist_version}`) : null;
      crits = checklist ? checklist.criteria : [];
    } catch (e) { CQA.fail($(".page"), e); return; }
    document.title = `${id} · 2MP`;
    $(".cmdbar__crumbs [aria-current]").textContent = id;
    const call = CQA.isCall(conv);
    const first = conv.transcript.find((u) => u.speaker === "client");
    $(".meta-row").innerHTML = `${CQA.channelTag(conv)}${CQA.langTag(conv.language)}${call ? `<span class="tag tag--amber">${ICON("mic")}Транскрипт ASR</span>` : ""}<span class="tag">${conv.transcript.length} реплик</span><span class="tag">${ICON("clock")}${CQA.mmss(conv.duration)}</span>${ev ? `<span class="tag">${ICON("checklist")}${E(ev.checklist_name)} v${ev.checklist_version}</span>` : ""}${coachCount() ? `<a class="tag coach-chip" href="#" data-first-coach>✨ ИИ-коуч: ${coachCount()} ${CQA.plural(coachCount(), "подсказка", "подсказки", "подсказок")}</a>` : ""}`;
    const h1 = $(".dlg-id"); h1.removeAttribute("data-decrypt"); h1.textContent = id;
    $(".hero .lead").textContent = first ? first.text : "";
    const [again, appeal] = $$(".hero__actions .btn");
    again.href = `run.html?ids=${encodeURIComponent(id)}`;
    if (!ev || ev.status !== "done") appeal.hidden = true;
    const nextBtn = $(".hero__actions .btn--icon"); if (nextBtn) { nextBtn.href = "index.html"; nextBtn.setAttribute("aria-label", "К списку"); }
    $(".transcript__body").innerHTML = transcriptHtml();
    $(".verdict-panel").innerHTML = panelHtml();
    fillModal();
    const chip = $("[data-first-coach]");
    if (chip) chip.addEventListener("click", (e) => { e.preventDefault(); const el = $(".coach"); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("is-hl"); void el.offsetWidth; el.classList.add("is-hl"); } });
    $$("[data-coach]").forEach((b) => b.addEventListener("click", () => {
      const el = $("#coach-" + b.dataset.coach); if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("is-hl"); void el.offsetWidth; el.classList.add("is-hl");
      setTimeout(() => el.classList.remove("is-hl"), 1300);
    }));
    if (call) setupPlayer();
    const rep = $("[data-replay]"); if (rep) rep.hidden = true;
    if (location.hash && $(location.hash)) $(location.hash).scrollIntoView();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
