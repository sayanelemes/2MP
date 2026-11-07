/* Связь с backend: запросы, форматы и обновление общей боковой панели. Подключается на каждой странице перед js/pages/*.js. */
(function () {
  const CQA = (window.CQA = window.CQA || {});
  const BASE = window.CQA_API_BASE || "";
  // Группа запоминается в браузере: ?g= выбирает и сохраняет, без параметра берётся последняя выбранная.
  const store = (v) => { try { return v === undefined ? localStorage.getItem("cqa.group") : localStorage.setItem("cqa.group", v); } catch { return null; } };
  const GROUP = new URLSearchParams(location.search).get("g") || store() || "DEV";
  store(GROUP);
  CQA.group = GROUP;
  CQA.CHECKLIST = "chat-quality";

  async function call(method, path, body) {
    const resp = await fetch(BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(errorText(data) || `Ошибка сервера ${resp.status}`);
    return data;
  }
  function errorText(d) {
    if (!d) return "";
    const x = d.detail !== undefined ? d.detail : d.message;
    return typeof x === "string" ? x : Array.isArray(x) ? x.map((e) => e.msg || e).join("; ") : "";
  }
  const q = (params) => {
    const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    return s.toString() ? "?" + s : "";
  };
  CQA.api = {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b || {}),
    put: (p, b) => call("PUT", p, b || {}),
    conversations: (p) => call("GET", "/api/conversations" + q({ group_id: GROUP, ...p })),
    conversation: (id) => call("GET", `/api/conversations/${GROUP}/${encodeURIComponent(id)}`),
    evaluation: (id) => call("GET", `/api/evaluations/${id}`),
    analytics: () => call("GET", "/api/analytics" + q({ group_id: GROUP })),
    appeals: (status) => call("GET", "/api/appeals" + q({ status })),
    checklists: () => call("GET", "/api/checklists"),
    job: (id) => call("GET", `/api/jobs/${id}`),
  };

  // Форматы.
  CQA.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  CQA.num = (x, d = 2) => (x === null || x === undefined ? "—" : Number(x).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: d }));
  CQA.mmss = (sec) => {
    if (sec === null || sec === undefined) return "—";
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  CQA.plural = (n, one, few, many) => {
    const m = Math.abs(n) % 100, d = m % 10;
    return m > 10 && m < 20 ? many : d > 1 && d < 5 ? few : d === 1 ? one : many;
  };
  CQA.scoreClass = (v) => (v === null || v === undefined ? "none" : v >= 85 ? "ok" : v >= 60 ? "mid" : "bad");
  CQA.isCall = (c) => c.channel === "voice call" || c.channel === "call";
  CQA.pageFor = (c) => `${CQA.isCall(c) ? "call" : "dialog"}.html?id=${encodeURIComponent(c.conversation_id)}&g=${encodeURIComponent(c.group_id || GROUP)}`;
  CQA.langTag = (l) => `<span class="tag tag--lang${l === "KZ" ? " tag--kz" : l === "EN" ? " tag--en" : ""}">${CQA.esc(l)}</span>`;
  CQA.channelTag = (c) => (CQA.isCall(c)
    ? '<span class="tag"><svg class="icon"><use href="#i-phone"/></svg>Звонок</span>'
    : '<span class="tag"><svg class="icon"><use href="#i-chat"/></svg>Чат</span>');
  CQA.ANSWER = { yes: "да", no: "нет", NA: "N/A" };

  // Состояние одного критерия для полосы: "" да, x нет, m частично, n N/A.
  CQA.barClass = (r) => {
    if (r.final_answer === "NA") return "n";
    const ratio = r.effective_weight ? r.points / r.effective_weight : null;
    if (ratio === null) return r.final_answer === "no" ? "x" : "";
    return ratio >= 0.999 ? "" : ratio <= 0.001 ? "x" : "m";
  };
  CQA.barWord = (r) => {
    const c = CQA.barClass(r);
    return c === "n" ? "N/A" : c === "x" ? "нет" : c === "m" ? "частично" : "да";
  };

  // Боковая панель на каждой странице: счётчики из базы.
  CQA.fillRail = async function () {
    try {
      const [list, appeals, lists] = await Promise.all([CQA.api.conversations(), CQA.api.appeals("open"), CQA.api.checklists()]);
      const meta = (href, text) => { const el = document.querySelector(`.rail__link[href="${href}"] .rail__meta`); if (el) { el.textContent = text; el.hidden = text === ""; } };
      meta("index.html", list.length);
      meta("appeals.html", appeals.length || "");
      meta("checklist.html", "v" + (lists[0] ? lists[0].version : ""));
      const ds = document.querySelector(".rail__dataset .rail__label");
      if (ds) ds.innerHTML = `<b>Набор ${CQA.esc(GROUP)}</b><small>${list.length} ${CQA.plural(list.length, "диалог", "диалога", "диалогов")} загружено</small>`;
      return { list, appeals, lists };
    } catch (e) {
      console.warn("Боковая панель: сервер недоступен", e);
      return null;
    }
  };

  // Сообщение об ошибке на странице, если сервер недоступен.
  CQA.fail = function (container, e) {
    const el = document.createElement("div");
    el.className = "card";
    el.style.cssText = "padding:20px;margin:16px 0;border-color:var(--bad)";
    el.textContent = "Не удалось получить данные: " + (e && e.message ? e.message : e);
    container.prepend(el);
  };

  document.addEventListener("DOMContentLoaded", () => CQA.fillRail());
})();
