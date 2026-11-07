/* Оценка диалогов: запуск POST /api/evaluations и ход по /api/jobs и /api/conversations. */
(function () {
  const CQA = window.CQA, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const E = CQA.esc, N = CQA.num;
  const ICON = (n, c) => `<svg class="icon${c ? " " + c : ""}"><use href="#i-${n}"/></svg>`;
  const params = new URLSearchParams(location.search);
  const picked = (params.get("ids") || "").split(",").filter(Boolean);
  let all = [], versions = [], timer = null;

  const radio = (name, title, desc, checked, value) => `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""}><span class="choice__title">${title}</span><span class="choice__desc">${desc}</span></label>`;
  const idsOf = (scope) => (scope === "all" ? all.map((c) => c.conversation_id) : scope === "new" ? all.filter((c) => c.status === "new").map((c) => c.conversation_id) : picked.filter((i) => all.some((c) => c.conversation_id === i)));

  function setup() {
    const chats = all.filter((c) => !CQA.isCall(c)).length, fresh = all.filter((c) => c.status === "new").length;
    $(".source__title").textContent = `${CQA.group} — ${all.length} ${CQA.plural(all.length, "диалог", "диалога", "диалогов")}`;
    $(".source__meta").textContent = `${chats} чатов и ${all.length - chats} звонков`;
    $(".source .btn").hidden = true;
    const det = $(".steps details"); if (det) det.hidden = true;
    $("#cl").innerHTML = versions.map((v, i) => `<option value="${v.version}">${E(v.name)}, версия ${v.version}${i === 0 ? " — активная" : ""}</option>`).join("");
    const ver = versions[0];
    $(".steps .step:nth-child(2) .field__hint").innerHTML = `Список версий хранится на сервере. <a href="checklist.html">Открыть в конструкторе</a>`;
    // Оценивает всегда модель на сервере: локального движка в этой версии нет.
    $(".steps .step:nth-child(3) .choices").innerHTML = radio("provider", "Модель через backend", "Критерии из чек-листа уходят модели как инструкция; готовые оценки берутся из кэша.", true, "server");
    const scopes = $(".steps .step:nth-child(4) .choices");
    scopes.innerHTML = radio("scope", `Все в наборе — ${all.length}`, "Одинаковые прошлые результаты берутся из кэша, новые считаются заново.", !fresh && !picked.length && !params.get("new"), "all")
      + radio("scope", `Только без оценки — ${fresh}`, "Новые диалоги, у которых ещё нет оценки.", !!params.get("new") || (fresh > 0 && !picked.length), "new")
      + (picked.length ? radio("scope", `Выбранные в списке — ${picked.length}`, E(picked.join(", ")), true, "picked") : "");
    if (!$("input[name=scope]:checked")) $("input[name=scope][value=all]").checked = true;
    const btn = $("[data-run-demo]"), fresh2 = btn.cloneNode(true);
    fresh2.removeAttribute("data-run-demo"); fresh2.removeAttribute("data-magnet"); btn.replaceWith(fresh2);
    const label = () => { const n = idsOf($("input[name=scope]:checked").value).length; fresh2.lastChild.textContent = ` Оценить ${n} ${CQA.plural(n, "диалог", "диалога", "диалогов")}`; fresh2.disabled = n === 0; };
    scopes.addEventListener("change", label); label();
    fresh2.addEventListener("click", () => start(ver, $("#cl").value, idsOf($("input[name=scope]:checked").value), $("input[name=scope]:checked").value === "all"));
    const sub = $(".subnav .tabs__count"); if (sub) sub.textContent = fresh;
    $$(".run-hud, [data-run-hud]").forEach((x) => (x.hidden = true));
    const jobsCard = $("[data-run-jobs]").closest(".card"); jobsCard.hidden = true;
    const alert = $(".alert--amber"); if (alert) alert.hidden = true;
  }

  async function start(ver, version, ids, whole) {
    const btn = $("[data-run-demo], .steps .btn--primary"); btn.disabled = true;
    try {
      const r = await CQA.api.post("/api/evaluations", { group_id: CQA.group, checklist_id: CQA.CHECKLIST, version: Number(version), ...(whole ? { all: true } : { conversation_ids: ids }) });
      track(r, ids, version);
    } catch (e) { btn.disabled = false; CQA.fail($(".page"), e); }
  }

  function track(run, ids, version) {
    const hud = $("[data-run-hud]"), jobs = $("[data-run-jobs]"), card = jobs.closest(".card"), t0 = Date.now();
    hud.hidden = false; card.hidden = false;
    $(".run-hud .btn")?.setAttribute("hidden", "");
    const shown = ids.length ? ids : all.map((c) => c.conversation_id);
    $(".card__head .tabs__count", card).textContent = shown.length;
    $("[data-run-title]").textContent = "Идёт оценка";
    $(".run-hud__top .muted").textContent = `чек-лист v${version}, модель на сервере`;
    clearInterval(timer);
    const tick = async () => {
      const [job, list] = await Promise.all([CQA.api.job(run.job_id), CQA.api.conversations()]);
      all = list;
      const by = Object.fromEntries(list.map((c) => [c.conversation_id, c]));
      const doneN = job.done, failN = job.failed, left = job.total - doneN - failN;
      $("[data-run-count]").textContent = doneN + failN;
      $(".run-hud__count small").textContent = ` из ${job.total}`;
      $(".progress__fill").style.setProperty("--p", job.total ? ((doneN + failN) / job.total) * 100 + "%" : "0%");
      $("[data-run-done]").textContent = doneN; $("[data-run-error]").textContent = failN; $("[data-run-left]").textContent = left;
      const scored = shown.map((i) => by[i]).filter((c) => c && c.status === "done" && c.final_total !== null);
      $("[data-run-avg]").textContent = scored.length ? N(scored.reduce((s, c) => s + c.final_total, 0) / scored.length) : "—";
      $("[data-run-eta]").textContent = run.reused ? `${run.reused} из кэша, без запросов к модели` : "";
      jobs.innerHTML = shown.map((i, k) => {
        const c = by[i]; if (!c) return "";
        const running = (job.status !== "done" && c.status === "queued") ? "queued" : c.status;
        const cls = c.status === "done" ? "done" : c.status === "failed" ? "error" : c.status === "needs_review" ? "error" : running === "running" ? "running" : "queued";
        const icon = cls === "done" ? ICON("check-circle") : cls === "error" ? ICON("x-circle") : cls === "running" ? '<span class="bars-loader"><i></i><i></i><i></i></span>' : "";
        const end = cls === "done" ? `<span class="score score--${CQA.scoreClass(c.final_total)}"><span class="score__value">${N(c.final_total)}</span></span>` : "";
        const note = cls === "done" ? "Готово" : c.status === "needs_review" ? "Нужна проверка: не оценён автоматически" : c.status === "failed" ? "Ошибка оценки" : cls === "running" ? "Оценивается" : "В очереди";
        return `<li class="job job--${cls}" style="--i:${k}"><span class="job__status">${icon}</span><a class="row-link" href="${CQA.pageFor(c)}">${E(i)}</a>${CQA.langTag(c.language)}<span class="job__note">${note}</span><span class="job__end">${end}</span></li>`;
      }).join("");
      if (job.status === "done" || left <= 0) {
        clearInterval(timer);
        $("[data-run-title]").textContent = failN ? "Оценка завершена, есть ошибки" : "Оценка завершена";
        $(".bars-loader[data-run-loader]")?.setAttribute("hidden", "");
        $(".steps .btn--primary").disabled = false;
        CQA.fillRail();
      }
    };
    timer = setInterval(() => tick().catch(() => {}), 2000);
    tick().catch((e) => CQA.fail($(".page"), e));
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      [all, versions] = await Promise.all([CQA.api.conversations(), CQA.api.get(`/api/checklists/${CQA.CHECKLIST}/versions`)]);
      setup();
    } catch (e) { CQA.fail($(".page"), e); }
  });
})();
