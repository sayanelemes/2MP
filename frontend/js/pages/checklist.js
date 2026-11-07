/* Конструктор чек-листа: версии с сервера, правка критериев в черновике, сохранение новой версии через PUT /api/checklists/{id}. */
(function () {
  const CQA = window.CQA, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const E = CQA.esc, N = CQA.num;
  const ICON = (n) => `<svg class="icon"><use href="#i-${n}"/></svg>`;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const st = { versions: [], base: null, draft: null, sel: 0, dirty: false, name: "" };
  const code = (c) => c.id.replace(/^\D+/, "");
  const sum = () => st.draft.reduce((s, c) => s + (c.is_critical ? 0 : Number(c.weight) || 0), 0);
  const typeTags = (c) => c.is_critical ? '<span class="tag tag--bad">Флаг</span><span class="tag">без баллов</span>'
    : `${c.type === "scale" ? `<span class="tag tag--amber">Шкала ${Math.min(...c.steps.map((s) => s.value))}–${Math.max(...c.steps.map((s) => s.value))}</span>` : '<span class="tag">Да / Нет</span>'}<span class="tag">${c.na_allowed ? "N/A" : "без N/A"}</span>`;
  const touch = () => { st.dirty = true; drawDraftBar(); drawMeter(); drawList(); };

  function drawVersions() {
    const latest = st.versions[0] && st.versions[0].version;
    $(".versions").innerHTML = st.versions.map((v) => `<a class="version${v.version === st.base.version ? " is-current" : ""}${v.version === latest ? " is-active" : ""}" href="#" data-v="${v.version}"><span class="version__top">Версия ${v.version}${v.version === latest ? '<span class="badge">активная</span>' : ""}</span><span class="version__meta">${new Date(v.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></a>`).join("");
    $$(".version").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); if (st.dirty && !confirm("Несохранённые изменения будут потеряны. Продолжить?")) return; await open(+a.dataset.v); }));
    const foot = $(".card__foot"); if (foot) foot.hidden = true;
  }

  function drawDraftBar() {
    const bar = $(".draft-bar"), next = st.versions[0].version + 1;
    bar.hidden = !st.dirty;
    $("span:nth-of-type(1)", bar).textContent = "Не сохранено: изменены критерии чек-листа";
    const [cancel, save] = [$(".btn--ghost", bar), $(".btn--primary", bar)];
    save.innerHTML = `${ICON("save")}Сохранить как версию ${next}`;
    save.removeAttribute("data-toast");
    save.onclick = async () => {
      save.disabled = true;
      try {
        const r = await CQA.api.put(`/api/checklists/${CQA.CHECKLIST}`, { name: st.name, criteria: st.draft });
        st.versions = await CQA.api.get(`/api/checklists/${CQA.CHECKLIST}/versions`);
        st.dirty = false; await open(r.version);
        CQA.fillRail();
        if (r.warnings && r.warnings.length) alert("Сохранено. " + r.warnings.join("; "));
      } catch (e) { alert(e.message); } finally { save.disabled = false; }
    };
    cancel.onclick = (e) => { e.preventDefault(); st.dirty = false; open(st.base.version); };
  }

  function drawMeter() {
    const s = sum(), ok = Math.round(s * 100) / 100 === 100;
    $("[data-weight-sum]").textContent = N(s);
    const tag = $("[data-weight-state]"); tag.textContent = ok ? "норма" : "не равна 100";
    tag.parentElement.className = "tag " + (ok ? "tag--ok" : "tag--amber");
    $(".weights-meter__bar").innerHTML = st.draft.filter((c) => !c.is_critical).map((c, i) => `<span class="wseg${st.draft[st.sel] === c ? " is-selected" : ""}" style="--w:${c.weight};--i:${i}" data-w="${c.weight}" data-tip="${code(c)} ${E(c.title)}: вес ${c.weight}">${code(c)}</span>`).join("");
  }

  function drawList() {
    const groups = [];
    st.draft.forEach((c) => { let g = groups.find((x) => x.name === c.section); if (!g) groups.push((g = { name: c.section, rows: [] })); g.rows.push(c); });
    $(".crit-list").innerHTML = groups.map((g, i) => `<div class="crit-group" style="--i:${i}"><div class="crit-group__head">${E(g.name)}<a class="btn btn--ghost btn--sm" href="#" data-add="${E(g.name)}">${ICON("plus")}Критерий</a></div>${g.rows.map((c) => `<a class="crit-row${st.draft[st.sel] === c ? " is-selected" : ""}" href="#" data-i="${st.draft.indexOf(c)}"><span class="drag-handle">${ICON("grip")}</span><span class="crit__code">${code(c)}</span><span class="crit-row__title">${E(c.title || "Новый критерий")}</span>${typeTags(c)}<span class="crit-row__weight">${c.is_critical ? "—" : c.weight}</span></a>`).join("")}</div>`).join("")
      + `<a class="btn btn--ghost" href="#" id="add-section" style="justify-self:start">${ICON("plus")}Добавить секцию</a>`;
    $$(".crit-row").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); st.sel = +a.dataset.i; drawList(); drawEditor(); drawMeter(); }));
    $$("[data-add]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); add(a.dataset.add); }));
    $("#add-section").addEventListener("click", (e) => { e.preventDefault(); const n = prompt("Название новой секции"); if (n && n.trim()) add(n.trim()); });
  }

  function add(section) {
    const n = Math.max(0, ...st.draft.map((c) => Number(code(c)) || 0)) + 1;
    st.draft.push({ id: "c" + String(n).padStart(2, "0"), section, title: "Новый критерий", type: "yes_no", weight: 0, instruction: "Да: опишите, что проверяем.", na_allowed: false, na_condition: "", is_critical: false, steps: [] });
    st.sel = st.draft.length - 1; touch(); drawEditor();
  }

  function drawEditor() {
    const c = st.draft[st.sel], ed = $(".editor");
    if (!c) { ed.hidden = true; return; }
    ed.hidden = false;
    $(".card__head .crit__code", ed).textContent = code(c);
    const sw = $(".card__head .switch", ed); if (sw) sw.hidden = true;
    $("#e-code").value = code(c); $("#e-code").disabled = true;
    $("#e-title").value = c.title;
    const sections = [...new Set(st.draft.map((x) => x.section))];
    $("#e-section").innerHTML = sections.map((s) => `<option${s === c.section ? " selected" : ""}>${E(s)}</option>`).join("");
    $("#e-desc").value = c.instruction;
    const kind = c.is_critical ? 2 : c.type === "scale" ? 1 : 0;
    $$(".type-pick input").forEach((r, i) => { r.checked = i === kind; });
    $("#e-weight").value = c.weight; $("#e-weight").disabled = c.is_critical;
    $("[data-weight-share]").textContent = c.is_critical ? "флаг без баллов" : `${N(c.weight)} из ${N(sum())}`;
    const steps = $(".scale-steps"), field = steps.closest(".field");
    field.hidden = c.type !== "scale" || c.is_critical;
    const max = Math.max(1, ...(c.steps || []).map((s) => Number(s.value) || 0));
    steps.innerHTML = (c.steps || []).map((s, i) => `<div class="scale-step"><input class="input input--num" type="number" min="0" value="${s.value}" data-si="${i}" data-k="value" aria-label="Балл"><input class="input" value="${E(s.label)}" data-si="${i}" data-k="label" aria-label="Описание"><span class="scale-step__pct">${Math.round((Number(s.value) / max) * 100)}%<i style="--p:${Math.max(4, (Number(s.value) / max) * 100)}%"></i></span></div>`).join("");
    const addStep = $(".row--between .btn", field); addStep.onclick = (e) => { e.preventDefault(); c.steps.push({ value: 0, label: "" }); touch(); drawEditor(); };
    $$("input", steps).forEach((i) => i.addEventListener("input", () => { const s = c.steps[+i.dataset.si]; s[i.dataset.k] = i.dataset.k === "value" ? Number(i.value) : i.value; st.dirty = true; drawDraftBar(); }));
    const na = $(".box .switch input", ed); na.checked = !!c.na_allowed; na.disabled = c.is_critical;
    $("#e-na").value = c.na_condition || ""; $("#e-na").disabled = !c.na_allowed;
    $$(".box", ed).slice(1).forEach((b) => b.remove());
    $("#e-rule")?.closest(".field")?.remove();
    na.onchange = () => { c.na_allowed = na.checked; $("#e-na").disabled = !na.checked; touch(); drawEditor(); };
    $("#e-na").oninput = (e) => { c.na_condition = e.target.value; st.dirty = true; drawDraftBar(); };
    $("#e-title").oninput = (e) => { c.title = e.target.value; touch(); };
    $("#e-desc").oninput = (e) => { c.instruction = e.target.value; st.dirty = true; drawDraftBar(); };
    $("#e-section").onchange = (e) => { c.section = e.target.value; touch(); };
    $("#e-weight").oninput = (e) => { c.weight = Number(e.target.value) || 0; touch(); $("[data-weight-share]").textContent = `${N(c.weight)} из ${N(sum())}`; };
    $$(".type-pick input").forEach((r, i) => { r.onchange = () => {
      if (i === 2) Object.assign(c, { is_critical: true, type: "yes_no", weight: 0, na_allowed: false, na_condition: "", steps: [] });
      else { c.is_critical = false; c.type = i === 1 ? "scale" : "yes_no"; if (i === 1 && !(c.steps || []).length) c.steps = [{ value: 10, label: "Полностью" }, { value: 0, label: "Нет" }]; if (i === 0) c.steps = []; }
      touch(); drawEditor();
    }; });
    const [del, dup] = $$(".card__foot .btn", ed), apply = $(".card__foot .btn:not(.btn--danger):not(.btn--ghost)", ed);
    del.onclick = (e) => { e.preventDefault(); if (st.draft.length < 2) return; st.draft.splice(st.sel, 1); st.sel = Math.max(0, st.sel - 1); touch(); drawEditor(); };
    dup.onclick = (e) => { e.preventDefault(); const n = Math.max(...st.draft.map((x) => Number(code(x)) || 0)) + 1; const copy = clone(c); copy.id = "c" + String(n).padStart(2, "0"); copy.title += " (копия)"; st.draft.push(copy); st.sel = st.draft.length - 1; touch(); drawEditor(); };
    apply.hidden = true;
  }

  async function open(version) {
    st.base = await CQA.api.get(`/api/checklists/${CQA.CHECKLIST}/versions/${version}`);
    st.draft = clone(st.base.criteria); st.name = st.base.name; st.sel = 0; st.dirty = false;
    $(".hero .lead").textContent = `Критерии, веса, шкалы и правила N/A. Сохранённая версия сразу используется для новых оценок, а прошлые оценки остаются со своей версией. Сейчас открыта версия ${version}.`;
    drawVersions(); drawDraftBar(); drawMeter(); drawList(); drawEditor();
  }

  function wireIo() {
    const exp = $(".hero__actions a.btn");
    exp.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ id: CQA.CHECKLIST, name: st.name, criteria: st.draft }, null, 2)], { type: "application/json" });
      exp.href = URL.createObjectURL(blob); exp.download = `${CQA.CHECKLIST}-v${st.base.version}.json`;
    });
    $('.hero__actions input[type="file"]').addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.criteria)) throw new Error("В файле нет списка criteria"); st.draft = d.criteria; if (d.name) st.name = d.name; st.sel = 0; st.dirty = true; drawDraftBar(); drawMeter(); drawList(); drawEditor(); }
      catch (x) { alert("Не удалось прочитать файл: " + x.message); }
      e.target.value = "";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      st.versions = await CQA.api.get(`/api/checklists/${CQA.CHECKLIST}/versions`);
      const w = $("#e-weight"); w.removeAttribute("data-weight-input"); w.replaceWith(w.cloneNode(true));  // снять обработчик демо из fx.js
      wireIo(); await open(st.versions[0].version);
    } catch (e) { CQA.fail($(".page"), e); }
  });
})();
