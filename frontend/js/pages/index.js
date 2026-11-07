/* Страница «Диалоги»: сводка и таблица из /api/conversations, /api/analytics, /api/evaluations. */
(function () {
  const CQA = window.CQA, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const PAGE = 16;
  const st = { all: [], extra: {}, channel: "all", langs: new Set(), status: "Все статусы", from: 0, to: 100, text: "", sort: "id", dir: 1, page: 0, picked: new Set(), gross: false };

  const STATUS = { "Без оценки": (c) => c.status === "new", "Оценён": (c) => c.status === "done", "Апелляция на проверке": (c) => c.open_appeals > 0, "Решение принято": (c, x) => x && x.decided, "Грубая ошибка": (c) => c.critical_flag };

  function visible() {
    const t = st.text.trim().toLowerCase();
    return st.all.filter((c) => {
      if (st.channel === "chat" && CQA.isCall(c)) return false;
      if (st.channel === "call" && !CQA.isCall(c)) return false;
      if (st.langs.size && !st.langs.has(c.language)) return false;
      if (st.gross && !c.critical_flag) return false;
      const f = STATUS[st.status];
      if (f && !f(c, st.extra[c.conversation_id])) return false;
      if (c.final_total !== null && c.final_total !== undefined && (c.final_total < st.from || c.final_total > st.to)) return false;
      if ((st.from > 0 || st.to < 100) && (c.final_total === null || c.final_total === undefined)) return false;
      if (t) {
        const x = st.extra[c.conversation_id];
        if (!(c.conversation_id.toLowerCase().includes(t) || (x && x.text.toLowerCase().includes(t)))) return false;
      }
      return true;
    }).sort((a, b) => {
      const key = st.sort === "score" ? (c) => (c.final_total === null || c.final_total === undefined ? 999 : c.final_total) : (c) => c.conversation_id;
      const ka = key(a), kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * st.dir;
    });
  }

  function sigCells(x, c) {
    if (!x || !x.results) return Array.from({ length: 8 }, (_, i) => `<i class="f" style="--i:${i}"></i>`).join("");
    const bars = x.results.slice(0, 7).map((r, i) => `<i class="${CQA.barClass(r)}${x.changed.has(r.criterion_id) ? " c" : ""}" style="--i:${i}"></i>`);
    bars.push(`<i class="${c.critical_flag ? "g" : "f"}" style="--i:7"></i>`);
    return bars.join("");
  }

  function row(c, i) {
    const x = st.extra[c.conversation_id];
    const none = c.final_total === null || c.final_total === undefined;
    const cls = CQA.scoreClass(c.final_total);
    const flags = [];
    if (c.critical_flag) flags.push('<span class="tag tag--bad"><svg class="icon"><use href="#i-flag"/></svg>Грубая ошибка</span>');
    if (c.open_appeals) flags.push('<span class="tag tag--amber"><svg class="icon"><use href="#i-scale"/></svg>Апелляция</span>');
    else if (x && x.decided) flags.push('<span class="tag tag--ok"><svg class="icon"><use href="#i-scale"/></svg>Решение принято</span>');
    if (c.status === "needs_review") flags.push('<span class="tag tag--amber">Нужна проверка</span>');
    if (x && x.na) flags.push(`<span class="tag">N/A: ${x.na}</span>`);
    const href = CQA.pageFor(c);
    const label = x && x.results ? "Критерии — " + x.results.slice(0, 7).map((r) => `${r.criterion_id.slice(1)}: ${CQA.barWord(r)}`).join("; ") : "Ещё не оценён";
    return `<tr style="--i:${i}"${st.picked.has(c.conversation_id) ? ' class="is-selected"' : ""}>
      <td><label class="check"><input type="checkbox" data-pick="${CQA.esc(c.conversation_id)}"${st.picked.has(c.conversation_id) ? " checked" : ""} aria-label="Выбрать ${CQA.esc(c.conversation_id)}"></label></td>
      <td><a class="row-link" href="${href}">${CQA.esc(c.conversation_id)}</a></td>
      <td>${CQA.channelTag(c)}</td><td>${CQA.langTag(c.language)}</td>
      <td class="col-num">${c.turn_count}</td><td class="col-num">${CQA.mmss(c.duration)}</td>
      <td><div class="request">${x ? CQA.esc(x.text) : ""}</div></td>
      <td><span class="sig" role="img" aria-label="${CQA.esc(label)}" data-tip="${CQA.esc(label)}">${sigCells(x, c)}</span></td>
      <td><span class="score score--${cls}"><span class="score__value">${none ? (c.status === "needs_review" ? "На проверку" : "Нет оценки") : CQA.num(c.final_total)}</span></span></td>
      <td><span class="flags">${flags.join("")}</span></td>
      <td><a class="row-go" href="${href}" aria-label="Открыть ${CQA.esc(c.conversation_id)}" data-tip="Открыть карточку"><svg class="icon"><use href="#i-chevron-right"/></svg></a></td></tr>`;
  }

  function renderTable() {
    const rows = visible(), pages = Math.max(1, Math.ceil(rows.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const part = rows.slice(st.page * PAGE, st.page * PAGE + PAGE);
    $("tbody").innerHTML = part.length ? part.map(row).join("") : '<tr><td colspan="11" style="padding:28px;text-align:center;color:var(--ink-3)">Ничего не найдено</td></tr>';
    const pager = $(".pager .num");
    pager.textContent = rows.length ? `Показано ${st.page * PAGE + 1}–${st.page * PAGE + part.length} из ${rows.length}` : "Показано 0";
    const [back, next] = $$(".pager .btn");
    back.disabled = st.page === 0; next.disabled = st.page >= pages - 1;
    const bar = $(".selection-bar");
    bar.style.display = st.picked.size ? "" : "none";
    bar.querySelector("span").textContent = `Выбрано ${st.picked.size} ${CQA.plural(st.picked.size, "диалог", "диалога", "диалогов")}`;
    bar.querySelector("a").href = "run.html?ids=" + [...st.picked].map(encodeURIComponent).join(",");
    $$('thead [aria-label="Выбрать все"]').forEach((b) => { b.checked = part.length > 0 && part.every((c) => st.picked.has(c.conversation_id)); });
  }

  function renderSummary(an) {
    const list = st.all, scored = list.filter((c) => c.final_total !== null && c.final_total !== undefined);
    const lead = $(".hero .lead");
    const chats = list.filter((c) => !CQA.isCall(c)).length, calls = list.length - chats;
    lead.textContent = `${chats} ${CQA.plural(chats, "чат", "чата", "чатов")} и ${calls} ${CQA.plural(calls, "звонок", "звонка", "звонков")}. У каждой оценки есть баллы, веса и реплики-доказательства.`;
    const fresh = list.filter((c) => c.status === "new").length;
    const go = $(".hero__actions .btn--primary");
    go.lastChild.textContent = fresh ? `Оценить новые: ${fresh}` : "Оценить набор";
    go.href = fresh ? "run.html?new=1" : "run.html";

    const hero = $(".tile--hero");
    const avg = an ? an.average_total : null;
    $(".tile__value", hero).innerHTML = `<span class="shiny">${CQA.num(avg)}</span><small>из 100</small>`;
    $(".tile__note", hero).textContent = `${scored.length} ${CQA.plural(scored.length, "оценённый диалог", "оценённых диалога", "оценённых диалогов")}, чек-лист «Качество чатов»`;
    const bins = Array(20).fill(0);
    scored.forEach((c) => { bins[Math.min(19, Math.floor(c.final_total / 5))]++; });
    const max = Math.max(1, ...bins);
    $(".histo", hero).innerHTML = bins.map((n, i) => `<div class="histo__bar rise${n ? "" : " is-empty"}${n && i * 5 < 60 ? " is-bad" : n && i * 5 < 85 ? " is-mid" : ""}" style="--h:${n ? Math.max(6, (n / max) * 100) : 2};--i:${i};--base:200ms" data-tip="Итог ${i * 5}–${i * 5 + 5}: ${n} ${CQA.plural(n, "диалог", "диалога", "диалогов")}"></div>`).join("");
    const hi = scored.filter((c) => c.final_total >= 85).length, mid = scored.filter((c) => c.final_total >= 60 && c.final_total < 85).length, low = scored.length - hi - mid;
    const lg = $$(".legend span b", hero);
    [hi, mid, low, list.length - scored.length].forEach((n, i) => { lg[i].textContent = n; });

    const gross = list.filter((c) => c.critical_flag).length;
    const g = $(".tile--gross");
    $(".tile__value", g).textContent = gross;
    $(".tile__note", g).textContent = gross ? `${gross} ${CQA.plural(gross, "диалог", "диалога", "диалогов")} с нарушением критерия «Грубая ошибка»` : "Грубых ошибок нет";

    const ap = an ? an.appeals : { open: 0, total: 0 };
    const a = $(".tile--appeal");
    $(".tile__value", a).textContent = ap.open;
    $(".tile__note", a).textContent = ap.open ? `ждут решения проверяющего, всего подано ${ap.total}` : `очередь пуста, всего подано ${ap.total}`;

    const by = { RU: 0, KZ: 0, EN: 0 };
    list.forEach((c) => { by[c.language] = (by[c.language] || 0) + 1; });
    const total = list.length || 1;
    const ring = $(".tile--lang .ring");
    ring.style.setProperty("--a", (by.RU / total) * 100);
    ring.style.setProperty("--b", (by.KZ / total) * 100);
    $(".tile--lang .ring-center b").textContent = list.length;
    const lb = $$(".tile--lang .legend b");
    [by.RU, by.KZ, by.EN].forEach((n, i) => { lb[i].textContent = n; });

    const weak = (an ? an.weak_criteria : []).slice(0, 4);
    $(".meter-list").innerHTML = weak.map((w, i) => {
      const p = Math.round(w.average_ratio * 100);
      return `<div class="meter"><span class="meter__code">${w.criterion_id.slice(1)}</span><span class="meter__bar" title="${CQA.esc(w.title)}"><i class="${p < 75 ? "is-low" : ""}" style="--p:${p}%;--i:${i}"></i></span><span class="meter__value">${p}%</span></div>`;
    }).join("");

    const seg = $$(".seg .seg__count");
    seg[0].textContent = list.length; seg[1].textContent = chats; seg[2].textContent = calls;
  }

  async function loadExtra() {
    // Запрос клиента и полосы критериев: по одному запросу на диалог, таблица обновляется по мере ответов.
    let n = 0;
    await Promise.all(st.all.map(async (c) => {
      try {
        const [conv, ev] = await Promise.all([CQA.api.conversation(c.conversation_id), c.evaluation_id && c.status === "done" ? CQA.api.evaluation(c.evaluation_id) : null]);
        const first = conv.transcript.find((u) => u.speaker === "client");
        const x = { text: first ? first.text : "" };
        if (ev) {
          x.results = ev.results;
          x.na = ev.results.filter((r) => r.final_answer === "NA").length;
          x.decided = ev.appeals.some((a) => a.status === "resolved");
          x.changed = new Set(ev.appeals.filter((a) => a.decision === "changed").map((a) => a.criterion_id));
        }
        st.extra[c.conversation_id] = x;
      } catch (e) { /* строка останется без запроса и полос */ }
      if (++n % 10 === 0) renderTable();
    }));
    renderTable();
  }

  function wire() {
    $$(".seg[aria-label=\"Канал\"] .seg__item").forEach((b, i) => b.addEventListener("click", () => {
      st.channel = ["all", "chat", "call"][i]; st.page = 0;
      $$(".seg[aria-label=\"Канал\"] .seg__item").forEach((x) => { const on = x === b; x.classList.toggle("is-active", on); x.setAttribute("aria-pressed", on); });
      renderTable();
    }));
    $$(".lang-chip").forEach((b) => b.addEventListener("click", () => {
      const l = b.textContent.trim(); st.langs.has(l) ? st.langs.delete(l) : st.langs.add(l);
      b.setAttribute("aria-pressed", st.langs.has(l)); st.page = 0; renderTable();
    }));
    $("#f-status").addEventListener("change", (e) => { st.status = e.target.value; st.page = 0; renderTable(); });
    const [from, to] = $$(".filters__range input");
    from.addEventListener("input", () => { st.from = +from.value || 0; st.page = 0; renderTable(); });
    to.addEventListener("input", () => { st.to = to.value === "" ? 100 : +to.value; st.page = 0; renderTable(); });
    $('.filters .search input').addEventListener("input", (e) => { st.text = e.target.value; st.page = 0; renderTable(); });
    $(".filters").addEventListener("submit", (e) => e.preventDefault());
    $(".filters").addEventListener("reset", () => {
      Object.assign(st, { channel: "all", status: "Все статусы", from: 0, to: 100, text: "", page: 0, gross: false }); st.langs.clear();
      $$(".lang-chip").forEach((b) => b.setAttribute("aria-pressed", "false"));
      $$(".seg[aria-label=\"Канал\"] .seg__item").forEach((x, i) => { x.classList.toggle("is-active", i === 0); x.setAttribute("aria-pressed", i === 0); });
      setTimeout(renderTable);
    });
    const [thId, thScore] = $$(".th-sort");
    [[thId, "id"], [thScore, "score"]].forEach(([a, key]) => a.addEventListener("click", (e) => {
      e.preventDefault(); st.dir = st.sort === key ? -st.dir : 1; st.sort = key;
      $$(".th-sort").forEach((x) => x.classList.toggle("is-active", x === a));
      renderTable();
    }));
    $("tbody").addEventListener("change", (e) => {
      const id = e.target.dataset && e.target.dataset.pick; if (!id) return;
      e.target.checked ? st.picked.add(id) : st.picked.delete(id); renderTable();
    });
    $('thead [aria-label="Выбрать все"]').addEventListener("change", (e) => {
      const rows = visible().slice(st.page * PAGE, st.page * PAGE + PAGE);
      rows.forEach((c) => (e.target.checked ? st.picked.add(c.conversation_id) : st.picked.delete(c.conversation_id))); renderTable();
    });
    $(".selection-bar .btn--ghost").addEventListener("click", () => { st.picked.clear(); renderTable(); });
    const [back, next] = $$(".pager .btn");
    back.addEventListener("click", () => { st.page--; renderTable(); });
    next.addEventListener("click", () => { st.page++; renderTable(); });
    $(".tile--gross .btn").addEventListener("click", () => { st.gross = true; st.page = 0; renderTable(); });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wire();
    $("tbody").innerHTML = '<tr><td colspan="11" style="padding:28px;text-align:center;color:var(--ink-3)">Загрузка…</td></tr>';
    try {
      const [list, an] = await Promise.all([CQA.api.conversations(), CQA.api.analytics()]);
      st.all = list;
      renderSummary(an); renderTable(); loadExtra();
    } catch (e) { CQA.fail($(".page"), e); $("tbody").innerHTML = ""; }
  });
})();
