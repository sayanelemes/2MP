/* Аналитика → «Анализ разговора»: дорожки, ключевые моменты, расшифровка и оценка одного разговора из API. */
(function () {
  const CQA = window.CQA, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const E = CQA.esc, N = CQA.num;
  const ICON = (n, c) => `<svg class="icon${c ? " " + c : ""}"><use href="#i-${n}"/></svg>`;
  const WHO = { client: "Клиент", bot: "Бот", operator: "Оператор" };
  let all = [], conv, ev, audio, total;

  const sec = (t) => (t === null || t === undefined ? 0 : t);
  const turnNo = (uid) => conv.transcript.findIndex((u) => u.id === uid) + 1;
  const pct = (t) => ((sec(t) / total) * 100).toFixed(1);
  const lost = (r) => (r.final_answer === "NA" || r.is_critical ? 0 : r.effective_weight - r.points);

  // Дорожка: колонка корзины «звучит», если в этот момент идёт реплика нужной роли.
  function lane(role, bots) {
    const bins = 120, spans = conv.transcript.map((u, i) => [sec(u.t), i + 1 < conv.transcript.length ? sec(conv.transcript[i + 1].t) : total, u.speaker]);
    return Array.from({ length: bins }, (_, i) => {
      const t = ((i + 0.5) / bins) * total, s = spans.find(([a, b]) => t >= a && t < b);
      const on = s && (s[2] === role || (bots && s[2] === "bot"));
      const h = on ? 30 + ((i * 37) % 60) : 6;
      return `<i class="${s && s[2] === "bot" && bots ? "is-bot " : ""}" style="--h:${h};--i:${i}"></i>`;
    }).join("");
  }

  function talkShare() {
    let c = 0, o = 0;
    conv.transcript.forEach((u, i) => {
      const end = i + 1 < conv.transcript.length ? sec(conv.transcript[i + 1].t) : total, d = Math.max(0, Math.min(end - sec(u.t), 30));
      if (u.speaker === "client") c += d; else if (u.speaker === "operator") o += d;
    });
    const s = c + o || 1;
    return [Math.round((c / s) * 100), 100 - Math.round((c / s) * 100)];
  }

  function moments() {
    const m = [];
    (ev && ev.status === "done" ? ev.results : []).forEach((r) => (r.evidence || []).slice(0, 1).forEach((e) => {
      const n = turnNo(e.id), u = conv.transcript[n - 1]; if (!n || !u) return;
      m.push({ n, t: sec(u.t), title: r.title, bad: r.is_critical ? r.final_answer === "yes" : r.final_answer === "no" });
    }));
    return m.sort((a, b) => a.t - b.t);
  }

  function setupAudio(ms) {
    const card = $(".audio"), hasAudio = !!conv.audio_path;
    const [cl, op] = talkShare();
    card.innerHTML = `<div class="audio__lanes"><div class="lane lane--client"><span class="lane__label"><i></i>Клиент</span><div class="wave" style="--played:0%">${lane("client", false)}</div></div>
      <div class="lane lane--operator"><span class="lane__label"><i></i>Оператор</span><div class="wave" style="--played:0%">${lane("operator", true)}</div></div>
      <div class="audio__track" aria-hidden="true"><span class="audio__head"></span></div>
      <div class="audio__track">${ms.map((m) => `<a class="audio__pin${m.bad ? " audio__pin--bad" : ""}" href="#t-${m.n}" data-at="${m.t}" style="--at:${pct(m.t)}%" data-tip="#${m.n} — ${E(m.title)}, ${CQA.mmss(m.t)}"></a>`).join("")}</div></div>
      <div class="audio__bar"><button class="player__play" type="button" aria-label="Воспроизвести или поставить на паузу"${hasAudio ? "" : " disabled"}>${ICON("play", "i-play")}${ICON("pause", "i-pause")}</button>
      <span class="audio__time"><b data-player-time>0:00</b><span> / ${CQA.mmss(total)}</span></span>
      <div class="seekbar" role="slider" tabindex="0" aria-label="Позиция записи" aria-valuemin="0" aria-valuemax="${Math.round(total)}" aria-valuenow="0"><span class="seekbar__fill"></span><span class="seekbar__knob"></span></div>
      <label class="sr-only" for="speed">Скорость</label><select class="select select--sm" id="speed" style="width:auto"><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></div>
      <div class="row row--between" style="gap:var(--s-3)"><div class="moments" aria-label="Ключевые моменты">${ms.map((m) => `<a class="moment${m.bad ? " moment--bad" : ""}" href="#t-${m.n}" data-at="${m.t}"><i></i><b>${CQA.mmss(m.t)}</b>${E(m.title)}</a>`).join("")}</div>
      <div class="talk"><span>Говорит клиент <b>${cl}%</b></span><span class="talk__split" aria-hidden="true"><span style="width:${cl}%"></span><span style="width:${op}%"></span></span><span>оператор <b>${op}%</b></span></div></div>
      ${hasAudio ? `<audio preload="metadata" src="${E(conv.audio_path)}"></audio>` : '<p class="muted small">У этого разговора нет аудиозаписи: дорожки построены по транскрипту.</p>'}`;
    const fresh = card.cloneNode(true); card.replaceWith(fresh);  // убрать обработчики демо-плеера из fx.js
    fresh.classList.remove("is-playing"); fresh.removeAttribute("data-start");
    audio = $("audio", fresh);
    const bar = $(".seekbar", fresh), fill = $(".seekbar__fill", fresh), knob = $(".seekbar__knob", fresh), head = $(".audio__head", fresh), time = $("[data-player-time]", fresh);
    const waves = $$(".wave", fresh), len = () => (audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : total);
    const paint = () => {
      const t = audio ? audio.currentTime : 0, p = Math.min(100, (t / len()) * 100);
      fill.style.width = p + "%"; knob.style.left = p + "%"; head.style.left = p + "%";
      waves.forEach((w) => $$("i", w).forEach((b, i, arr) => b.classList.toggle("is-played", i / arr.length * 100 < p)));
      time.textContent = CQA.mmss(t); bar.setAttribute("aria-valuenow", Math.round(t));
      const now = conv.transcript.reduce((a, u, i) => (sec(u.t) <= t + 0.2 ? i + 1 : a), 0);
      $$(".tr-list .turn.is-playing").forEach((x) => x.classList.remove("is-playing"));
      if (audio && !audio.paused) { const li = $("#t-" + now); if (li) li.classList.add("is-playing"); }
    };
    paint();
    if (!audio) return;
    const seek = (t) => { audio.currentTime = Math.max(0, Math.min(t, len())); paint(); };
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("play", () => fresh.classList.add("is-playing"));
    audio.addEventListener("pause", () => { fresh.classList.remove("is-playing"); paint(); });
    $(".player__play", fresh).addEventListener("click", () => (audio.paused ? audio.play().catch((e) => CQA.fail($(".page"), e)) : audio.pause()));
    bar.addEventListener("click", (e) => { const r = bar.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * len()); });
    bar.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") seek(audio.currentTime + 5); if (e.key === "ArrowLeft") seek(audio.currentTime - 5); });
    $("#speed", fresh).addEventListener("change", (e) => { audio.playbackRate = +e.target.value; });
    $$("[data-at]", fresh).forEach((a) => a.addEventListener("click", () => { seek(+a.dataset.at); audio.play().catch(() => {}); }));
  }

  function transcriptHtml() {
    const marks = {};
    (ev && ev.status === "done" ? ev.results : []).forEach((r) => (r.evidence || []).forEach((e) => {
      const n = turnNo(e.id); if (!n) return;
      const kind = r.is_critical ? (r.final_answer === "yes" ? "violation" : "context") : r.final_answer === "no" ? "violation" : r.final_answer === "NA" ? "context" : "support";
      (marks[n] = marks[n] || []).push(`<a class="mark mark--${kind}" href="#c-${r.criterion_id.slice(1)}" title="${E(r.title)}">${r.criterion_id.slice(1)}</a>`);
    }));
    return conv.transcript.map((u, i) => {
      const n = i + 1;
      if (u.speaker === "system") return `<li class="turn turn--system" id="t-${n}" style="--i:${Math.min(i, 30)}"><span class="turn__sys">${ICON("mic")}${E(u.text)}</span></li>`;
      const chip = conv.audio_path && u.t !== null ? `<a class="play-chip" href="#t-${n}" data-at="${u.t}" aria-label="Слушать с ${CQA.mmss(u.t)}">${ICON("play")}${CQA.mmss(u.t)}</a>` : `<span class="tr-row__no">${CQA.mmss(u.t)}</span>`;
      return `<li class="turn turn--${u.speaker}" id="t-${n}" style="--i:${Math.min(i, 30)}"><div class="tr-row__meta">${chip}<span class="tr-row__who">${WHO[u.speaker] || ""}</span><span class="tr-row__no">#${n}</span></div><p class="turn__text">${E(u.text)}</p>${marks[n] ? `<div class="turn__marks">${marks[n].join("")}</div>` : ""}</li>`;
    }).join("");
  }

  function quality() {
    const secQ = $("#quality .card"), head = $("#quality .ana-section__desc"), actions = $("#quality .ana-section__actions");
    if (!ev || ev.status !== "done") {
      head.textContent = ev ? "Автоматическая оценка не выполнена: нужна проверка" : "Оценки пока нет";
      actions.innerHTML = ""; secQ.innerHTML = `<div class="quality__side"><p class="muted">${E((ev && ev.error) || "Запустите оценку на странице «Оценка диалогов».")}</p><a class="btn btn--primary" href="run.html?ids=${encodeURIComponent(conv.conversation_id)}">Оценить</a></div>`;
      return;
    }
    head.textContent = `Чек-лист «${ev.checklist_name}», версия ${ev.checklist_version}. Оценено ${new Date(ev.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}, ${ev.model}`;
    actions.innerHTML = `<span class="verdict ${ev.final_critical_flag ? "verdict--no" : "verdict--yes"} stamp">${ev.final_critical_flag ? "Грубая ошибка" : "Оценён"}</span>`;
    const avg = (all.filter((c) => c.final_total !== null && c.final_total !== undefined).reduce((s, c) => s + c.final_total, 0)) / Math.max(1, all.filter((c) => c.final_total !== null && c.final_total !== undefined).length);
    const diff = ev.final_total - avg;
    const rs = ev.results, na = rs.filter((r) => r.final_answer === "NA" && !r.is_critical);
    const reasons = rs.filter((r) => lost(r) > 0.005).sort((a, b) => lost(b) - lost(a)).map((r) => {
      const e = (r.evidence || [])[0], n = e ? turnNo(e.id) : 0;
      return `<a class="reason" href="#t-${n || 1}" data-at="${n ? sec(conv.transcript[n - 1].t) : 0}"><span class="reason__delta">−${N(lost(r))}</span><span><b>${E(r.title)}.</b> ${E(r.reason || "")}${n ? `<small>${CQA.mmss(conv.transcript[n - 1].t)}, реплика #${n}</small>` : ""}</span></a>`;
    }).concat(na.map((r) => `<div class="reason reason--na"><span class="reason__delta">N/A</span><span><b>${E(r.title)}.</b> ${E(r.reason || "")}</span></div>`));
    const rows = rs.map((r, i) => {
      const e = (r.evidence || [])[0], n = e ? turnNo(e.id) : 0, code = r.criterion_id.slice(1);
      const href = n ? `#t-${n}` : "#";
      if (r.is_critical) return `<li><span class="qrow qrow--flag" id="c-${code}"><span class="qrow__icon">${ICON("shield")}</span><span class="qrow__name"><small>${code}</small>${E(r.title)}</span><span class="qrow__pts"><b>${r.final_answer === "yes" ? "есть" : "нет"}</b> — в итог не входит</span></span></li>`;
      const c = CQA.barClass(r), cls = c === "n" ? " qrow--na" : c === "x" || c === "m" ? " qrow--mid" : "", f = r.effective_weight ? r.points / r.effective_weight : 0;
      return `<li><a class="qrow${cls}" id="c-${code}" href="${href}" data-at="${n ? sec(conv.transcript[n - 1].t) : 0}"><span class="qrow__icon">${ICON(c === "n" ? "x" : c === "" ? "check" : "alert")}</span><span class="qrow__name"><small>${code}</small>${E(r.title)}</span><span class="qrow__pts">${c === "n" ? "<b>N/A</b> — вес перераспределён" : `<b>${N(r.points)}</b> / ${N(r.effective_weight)}`}</span><span class="qrow__bar"><i style="--f:${f.toFixed(2)};--i:${i}"></i></span></a></li>`;
    }).join("");
    const first = reasons.length ? "" : "";
    secQ.innerHTML = `<span class="scorecard__glow" aria-hidden="true"></span><div class="quality__side"><div class="quality__top"><div class="gauge" style="--p:${ev.final_total}" role="img" aria-label="Итог ${N(ev.final_total)} из 100"><svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="g-gauge" x1="0" y1="0" x2="1" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></defs><circle class="gauge__track" cx="60" cy="60" r="52"/><circle class="gauge__value" cx="60" cy="60" r="52" pathLength="100"/></svg><div class="gauge__label"><b class="shiny">${N(ev.final_total)}</b><span>из 100</span></div></div>
      <div class="quality__meta"><span class="tag ${diff >= 0 ? "tag--ok" : "tag--amber"}">${ICON("trend")}${diff >= 0 ? "выше" : "ниже"} среднего по набору на ${N(Math.abs(diff))}</span>${na.length ? `<p class="small muted">N/A: ${na.map((r) => r.criterion_id.slice(1)).join(", ")} — вес перераспределён между остальными критериями.</p>` : ""}</div></div>
      <div class="reasons"><p class="reasons__title">Почему снижена оценка</p>${reasons.join("") || '<p class="small muted">Баллы не снижались.</p>'}</div>
      <div class="quality__actions"><a class="btn btn--primary" href="${CQA.pageFor(conv)}">${ICON("check")}Открыть карточку и оспорить</a></div></div>
      <div class="quality__main"><p class="quality__label">Критерии — нажмите, чтобы перейти к доказательству</p><ul class="qlist">${rows}</ul></div>${first}`;
    $$("[data-at]", secQ).forEach((a) => a.addEventListener("click", () => { if (audio) { audio.currentTime = +a.dataset.at; audio.play().catch(() => {}); } }));
  }

  async function show(id) {
    conv = await CQA.api.conversation(id);
    const pick = conv.evaluations.find((e) => e.status !== "queued" && e.status !== "running") || conv.evaluations[0];
    ev = pick ? await CQA.api.evaluation(pick.id) : null;
    total = conv.duration || Math.max(1, ...conv.transcript.map((u) => sec(u.t)));
    history.replaceState(null, "", `?id=${encodeURIComponent(id)}&g=${CQA.group}`);
    document.title = `${id} · Анализ разговора · CQA`;
    const first = conv.transcript.find((u) => u.speaker === "client");
    $(".meta-row").innerHTML = `${CQA.channelTag(conv)}${CQA.langTag(conv.language)}<span class="tag">${ICON("clock")}${CQA.mmss(total)}</span>${CQA.isCall(conv) ? `<span class="tag tag--amber">${ICON("mic")}Транскрипт ASR</span>` : ""}`;
    const h1 = $(".dlg-id"); h1.removeAttribute("data-decrypt"); h1.textContent = id;
    $(".hero .lead").textContent = first ? first.text : "";
    const ms = moments();
    setupAudio(ms);
    $("#transcript .ana-section__desc").textContent = `${conv.transcript.length} реплик. Нажмите на время у реплики, чтобы услышать запись с этого места`;
    $(".tr-list").innerHTML = transcriptHtml();
    $("#transcript .ana-section__actions").innerHTML = "";
    $("#transcript").onclick = (e) => { const c = e.target.closest(".play-chip"); if (c && audio) { e.preventDefault(); audio.currentTime = +c.dataset.at; audio.play().catch(() => {}); } };
    quality();
    const sel = $("#ana-pick"); if (sel.value !== id) sel.value = id;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      all = await CQA.api.conversations();
      const sorted = [...all].sort((a, b) => (CQA.isCall(b) - CQA.isCall(a)) || a.conversation_id.localeCompare(b.conversation_id));
      const sel = $("#ana-pick");
      sel.innerHTML = sorted.map((c) => `<option value="${E(c.conversation_id)}">${E(c.conversation_id)} — ${CQA.isCall(c) ? "звонок" : "чат"}, ${CQA.mmss(c.duration)}${c.final_total !== null && c.final_total !== undefined ? ", итог " + N(c.final_total) : ""}</option>`).join("");
      const want = new URLSearchParams(location.search).get("id") || (sorted.find((c) => CQA.isCall(c)) || sorted[0]).conversation_id;
      const [prev, next] = $$(".ana-switch .btn--icon");
      const go = (d) => { const i = sorted.findIndex((c) => c.conversation_id === sel.value); show(sorted[(i + d + sorted.length) % sorted.length].conversation_id); };
      prev.addEventListener("click", (e) => { e.preventDefault(); go(-1); }); next.addEventListener("click", (e) => { e.preventDefault(); go(1); });
      sel.addEventListener("change", () => show(sel.value));
      const run = $(".subnav .tabs__count"); if (run) run.textContent = all.filter((c) => c.status === "new").length;
      await show(want);
    } catch (e) { CQA.fail($(".page"), e); }
  });
})();
