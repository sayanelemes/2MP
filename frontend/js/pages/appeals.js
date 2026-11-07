/* Апелляции: очередь и решение проверяющего через /api/appeals. */
(function () {
  const CQA = window.CQA, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const E = CQA.esc, N = CQA.num;
  const ICON = (n, c) => `<svg class="icon${c ? " " + c : ""}"><use href="#i-${n}"/></svg>`;
  const WHO = { client: ["Клиент", "user", ""], bot: ["Бот", "bot", " avatar--bot"], operator: ["Оператор", "headset", " avatar--operator"] };
  const st = { all: [], tab: "open", id: Number(new URLSearchParams(location.search).get("id")) || null };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const age = (iso) => {
    const m = Math.max(0, (Date.now() - new Date(iso)) / 60000);
    return m < 60 ? `${Math.round(m)} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн назад`;
  };
  const refs = (t) => E(t).replace(/#(\d+)/g, '<a class="turn-ref" href="#t-$1">#$1</a>');
  const stepLabel = (a, v) => (a.type === "scale" ? `${v} из ${Math.max(0, ...a.steps.map((s) => s.value))}` : CQA.ANSWER[v] || v);
  const verdictOf = (a, v) => (a.criterion.is_critical ? ["verdict--gross", v === "yes" ? "Да" : "Нет"] : v === "NA" ? ["verdict--na", "N/A"] : a.type === "scale" ? ["verdict--mid", stepLabel(a, v)] : v === "yes" ? ["verdict--yes", "Да"] : ["verdict--no", "Нет"]);
  const list = () => st.all.filter((a) => (st.tab === "all" ? true : st.tab === "open" ? a.status === "open" : a.status !== "open"));

  function renderTabs() {
    const tabs = $$(".tabs__item"), counts = [st.all.filter((a) => a.status === "open").length, st.all.filter((a) => a.status !== "open").length, st.all.length];
    ["open", "resolved", "all"].forEach((k, i) => {
      tabs[i].setAttribute("aria-selected", st.tab === k);
      $(".tabs__count", tabs[i]).textContent = counts[i];
      tabs[i].onclick = (e) => { e.preventDefault(); st.tab = k; st.id = null; render(); };
    });
  }

  function renderQueue(items, cur) {
    $(".queue").innerHTML = items.map((a, i) => {
      const [vc, vt] = verdictOf(a, a.final_answer);
      return `<a class="card spot qcard${cur && a.id === cur.id ? " is-current beam beam--amber" : ""}" href="?id=${a.id}" data-id="${a.id}" style="--i:${i}">
        <span class="qcard__top"><span class="qcard__id">${E(a.conversation_id)}</span>${CQA.isCall(a) ? `<span class="tag tag--call">${ICON("phone")}Звонок</span>` : ""}${a.status !== "open" ? '<span class="tag tag--ok">Решено</span>' : ""}<span class="qcard__age">${age(a.created_at)}</span></span>
        <span class="qcard__crit">${E(a.criterion_id.slice(1))} ${E(a.title)}</span>
        <span class="row" style="gap:6px"><span class="verdict ${vc}">${E(vt)}</span><span class="muted small">итог ${N(a.final_total)}</span></span>
        <span class="qcard__comment">«${E(a.comment)}»</span></a>`;
    }).join("") || '<p class="muted" style="padding:var(--s-5)">Здесь пока ничего нет.</p>';
    $$(".qcard").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); st.id = +el.dataset.id; render(); }));
  }

  function fragmentHtml(a) {
    const ev = new Set((a.evidence || []).map((e) => e.id));
    return a.fragment.map((u, i) => {
      const n = u.id.replace(/^\D+/, ""), [who, icon, ac] = WHO[u.speaker] || ["Реплика", "user", ""];
      const cls = ev.has(u.id) ? (a.final_answer === "no" || a.criterion.is_critical ? " is-violation" : " is-evidence") : " is-dim";
      if (u.speaker === "system") return "";
      return `<li class="turn turn--${u.speaker}${cls}" id="t-${n}" style="--i:${i}"><span class="avatar${ac}">${ICON(icon)}</span><div class="turn__body"><div class="turn__meta"><span class="turn__no">#${n}</span><span class="turn__who">${who}</span><time class="turn__time">${CQA.mmss(u.t)}</time></div><p class="turn__text">${E(u.text)}</p></div></li>`;
    }).join("");
  }

  function renderCase(a) {
    const box = $(".case");
    if (!a) { box.innerHTML = '<p class="muted">Нет апелляций для рассмотрения.</p>'; return; }
    const [vc, vt] = verdictOf(a, a.ai_answer);
    const open = a.status === "open", crit = a.criterion;
    const newOpts = a.type === "scale" ? a.steps.map((s) => `<option value="${s.value}">${s.value} — ${E(s.label)}</option>`).join("") : '<option value="yes">Да</option><option value="no">Нет</option>';
    const opts = newOpts + (a.na_allowed ? '<option value="NA">N/A — неприменимо</option>' : "");
    const resolved = open ? "" : `<div class="alert"><p class="small"><b>Решение: ${a.decision === "changed" ? `оценка изменена на «${E(String(stepLabel(a, a.new_answer)))}»` : "оценка подтверждена"}.</b> ${E(a.decision_reason || "")} <span class="tiny">${E(a.decided_by || "")}, ${dt(a.decided_at)}</span></p></div>`;
    box.innerHTML = `<div class="case__head"><div class="stack stack--sm"><div class="row"><a class="row-link" href="${CQA.pageFor(a)}" style="font-size:var(--fs-18)">${E(a.conversation_id)}</a>${CQA.channelTag(a)}${CQA.langTag(a.language)}</div><h2 class="h2">${E(crit.id.slice(1))} ${E(a.title)}</h2></div><a class="btn btn--sm" href="${CQA.pageFor(a)}" style="margin-left:auto">${ICON("external")}Открыть диалог</a></div>
      <div class="versus"><div class="versus__side"><div class="versus__head">${ICON("cpu", "icon--sm")}Оценка ИИ</div><div class="row"><span class="verdict ${vc} verdict--lg">${E(vt)}</span><span class="muted small">итог диалога ${N(a.ai_total)}</span></div><p class="small" style="color:var(--ink-2)">${refs(a.reason || "")}</p></div>
      <div class="versus__mid" aria-hidden="true"><span class="versus__vs">vs</span></div>
      <div class="versus__side versus__side--appeal"><div class="versus__head">${ICON("message", "icon--sm")}Комментарий оператора<span class="tiny">${dt(a.created_at)}</span></div><p class="small" style="color:var(--ink-2)">«${E(a.comment)}»</p></div></div>
      <div class="stack stack--sm"><span class="field__label">Фрагмент диалога, на который ссылаются оценка и апелляция</span><ol class="fragment">${fragmentHtml(a)}</ol></div>
      ${open ? `<form class="stack" aria-label="Решение"><span class="h3">Решение</span>
        <div class="choices choices--2"><label class="choice"><input type="radio" name="decision" value="confirmed"><span class="choice__title">Подтвердить оценку</span><span class="choice__desc">Ответ остаётся, итог не меняется</span></label>
        <label class="choice choice--amber"><input type="radio" name="decision" value="changed" checked><span class="choice__title">Изменить оценку</span><span class="choice__desc">Выберите новый ответ и объясните почему</span></label></div>
        <div class="editor__grid" style="grid-template-columns:minmax(0,220px) minmax(0,1fr)"><div class="field"><label class="field__label" for="d-new">Новый ответ</label><select class="select" id="d-new">${opts}</select></div>
        <div class="field"><label class="field__label" for="d-reason">Причина решения</label><textarea class="textarea" id="d-reason" rows="3"></textarea><span class="field__hint">Причину увидят оператор и все, кто откроет карточку диалога.</span></div></div>
        <p class="alert alert--bad" id="d-err" hidden></p>
        <div class="row"><button class="btn btn--primary btn--lg beam" type="submit">${ICON("save")}Сохранить решение</button></div></form>` : resolved}`;
    const form = $("form", box); if (!form) return;
    const sel = $("#d-new", form), radios = $$('input[name="decision"]', form);
    const sync = () => { sel.disabled = radios.find((r) => r.checked).value !== "changed"; };
    radios.forEach((r) => r.addEventListener("change", sync)); sync();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const decision = radios.find((r) => r.checked).value, err = $("#d-err", form), btn = $("button", form);
      let answer = decision === "changed" ? sel.value : null;
      if (answer !== null && a.type === "scale" && answer !== "NA") answer = Number(answer);
      btn.disabled = true; err.hidden = true;
      try {
        await CQA.api.post(`/api/appeals/${a.id}/decision`, { decision, new_answer: answer, decision_reason: $("#d-reason", form).value, decided_by: "Проверяющий" });
        st.id = null; await load(); CQA.fillRail();
      } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
    });
  }

  function render() {
    renderTabs();
    const items = list(), cur = items.find((a) => a.id === st.id) || items[0] || null;
    renderQueue(items, cur); renderCase(cur);
  }
  async function load() { st.all = await CQA.api.appeals(); render(); }

  document.addEventListener("DOMContentLoaded", () => load().catch((e) => CQA.fail($(".page"), e)));
})();
