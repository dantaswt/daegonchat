const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const initials = (name) =>
  escape(
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase(),
  );
const formatDate = (value) =>
  new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
const state = {
  user: null,
  departments: [],
  contacts: [],
  conversations: [],
  users: [],
  view: "dashboard",
  selected: null,
  filter: "open",
  search: "",
  report: null,
};
let renderVersion = 0,
  polling = false,
  toastTimer;
const icons = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  inbox: "M4 4h16v12h-5l-3 4-3-4H4z M8 8h8 M8 12h5",
  contacts:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
  departments:
    "M4 21V5h10v16 M14 10h6v11 M2 21h20 M7 8h4 M7 12h4 M7 16h4 M17 13v2",
  users: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M5 21v-3a7 7 0 0 1 14 0v3",
  bot: "M5 7h14v13H5z M12 3v4 M9 12h.01 M15 12h.01 M9 16h6 M2 11v5 M22 11v5",
  reports: "M4 21V3 M4 21h17 M8 17v-5 M13 17V7 M18 17V3",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.inbox}"/></svg>`;
const labels = {
  dashboard: "Visão geral",
  inbox: "Atendimentos",
  contacts: "Contatos",
  departments: "Departamentos",
  users: "Equipe",
  bot: "Bot de atendimento",
  reports: "Relatórios",
  settings: "WhatsApp API",
};
const statusLabels = {
  waiting: "Na fila",
  active: "Em atendimento",
  closed: "Resolvido",
  pending: "Aguardando envio",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  received: "Recebido",
  internal: "Nota interna",
  failed: "Falhou",
};
const badge = (status) =>
  `<span class="badge ${escape(status)}">● ${escape(statusLabels[status] || status)}</span>`;
const person = (name, detail = "") =>
  `<div class="person"><span class="avatar">${initials(name)}</span><div><strong>${escape(name)}</strong>${detail ? `<small>${escape(detail)}</small>` : ""}</div></div>`;
const empty = (title, detail = "") =>
  `<div class="empty"><span class="empty-symbol">◇</span><b>${escape(title)}</b>${escape(detail)}</div>`;
const departmentName = (id) =>
  state.departments.find((d) => d.id === id)?.name || "Triagem";
const departmentOptions = (selected, blank = false) =>
  `${blank ? '<option value="">Sem departamento</option>' : ""}${state.departments
    .filter((d) => d.active || d.id === selected)
    .map(
      (d) =>
        `<option value="${d.id}" ${d.id === Number(selected) ? "selected" : ""}>${escape(d.name)}${d.active ? "" : " (inativo)"}</option>`,
    )
    .join("")}`;
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const heading = (title, description, actions = "") =>
  `<div class="page-head"><div><span class="eyebrow">RELACIONAMENTO EM MOVIMENTO</span><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="head-actions">${actions}</div>` : ""}</div>`;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
async function api(path, method = "GET", body) {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Não foi possível concluir a solicitação." }));
  if (!response.ok) {
    if (response.status === 401) {
      showLogin();
    }
    throw new Error(data.error || data.message || "Falha na operação.");
  }
  return data;
}
function showLogin() {
  state.user = null;
  renderVersion++;
  state.selected = null;
  state.conversations = [];
  state.contacts = [];
  state.users = [];
  $("#main").innerHTML = "";
  $("#workspace").hidden = true;
  $("#login").hidden = false;
  $("#modal").close();
  $("#modalFields").innerHTML = "";
}
async function boot() {
  try {
    state.user = await api("/me");
    state.departments = await api("/departments");
    $("#login").hidden = true;
    $("#workspace").hidden = false;
    $("#userName").textContent = state.user.name;
    $("#userAvatar").textContent = state.user.name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("");
    $("#userRole").textContent =
      state.user.role === "admin"
        ? "Administrador"
        : departmentName(state.user.department_id);
    $("#today").textContent = new Date().toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "short",
    });
    renderNav();
    await navigate("dashboard");
  } catch (error) {
    showLogin();
    if (error.message !== "Entre na sua conta para continuar.")
      $("#loginError").textContent = error.message;
  }
}
function renderNav() {
  $("#nav").innerHTML = Object.entries(labels)
    .filter(
      ([key]) =>
        state.user.role === "admin" ||
        ["dashboard", "inbox", "contacts", "reports"].includes(key),
    )
    .map(
      ([key, label]) =>
        `<button class="nav-button ${key === state.view ? "active" : ""}" data-nav="${key}">${icon(key)}${label}</button>`,
    )
    .join("");
}
async function navigate(view) {
  const version = ++renderVersion;
  state.view = view;
  renderNav();
  $("#pageLabel").textContent = labels[view];
  $("#sidebar").classList.remove("open");
  $("#menuBtn").setAttribute("aria-expanded", "false");
  $("#main").innerHTML = '<div class="loading">Carregando seu workspace…</div>';
  try {
    state.departments = await api("/departments");
    if (version !== renderVersion) return;
    if (view === "dashboard" || view === "reports") {
      state.report = await api("/reports");
      if (version !== renderVersion) return;
      view === "dashboard" ? renderDashboard() : renderReports();
    }
    if (view === "contacts") {
      state.contacts = await api("/contacts");
      if (version !== renderVersion) return;
      renderContacts();
    }
    if (view === "departments") renderDepartments();
    if (view === "users") {
      state.users = await api("/users");
      if (version !== renderVersion) return;
      renderUsers();
    }
    if (view === "inbox") {
      state.conversations = await api("/conversations");
      if (version !== renderVersion) return;
      renderInbox();
    }
    if (view === "bot" || view === "settings") {
      const settings = await api("/settings");
      if (version !== renderVersion) return;
      view === "bot" ? renderBot(settings) : renderSettings(settings);
    }
  } catch (error) {
    if (version === renderVersion)
      $("#main").innerHTML = empty("Não foi possível carregar", error.message);
  }
}
function stats(report) {
  return `<div class="stats">${[
    [
      "Total de atendimentos",
      report.total,
      "Todas as conversas do período",
      "inbox",
    ],
    ["Aguardando atendimento", report.waiting, "Conversas na fila", "contacts"],
    ["Em atendimento", report.active, "Cuidando de cada conversa", "users"],
    ["Resolvidos", report.closed, "Atendimentos concluídos", "reports"],
  ]
    .map(
      ([label, value, detail, i]) =>
        `<article class="stat"><div class="stat-top">${label}<span class="stat-icon">${icon(i)}</span></div><strong>${value}</strong><small>${detail}</small></article>`,
    )
    .join("")}</div>`;
}
function reportTable(rows) {
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Departamento</th><th>Status</th><th>Responsável</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${person(r.name, formatDate(r.created_at))}</td><td>${escape(r.department_name || "Triagem")}</td><td>${badge(r.status)}</td><td>${escape(r.assignee_name || "Não atribuído")}</td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "As boas conversas começam por aqui",
        "Os atendimentos recebidos pelo WhatsApp aparecerão neste espaço.",
      );
}
function bars(report) {
  return report.departments.length
    ? `<div class="department-bars">${report.departments.map((d) => `<div class="bar-row"><div class="bar-label"><span>${escape(d.name)}</span><b>${d.total}</b></div><progress class="bar-track" value="${d.total}" max="${Math.max(...report.departments.map((x) => x.total), 1)}" aria-label="${escape(d.name)}: ${d.total} atendimentos"></progress></div>`).join("")}</div>`
    : empty(
        "Sua operação, por departamento",
        "Cadastre os setores e acompanhe a distribuição dos atendimentos.",
      );
}
function renderDashboard() {
  const report = state.report;
  $("#main").innerHTML =
    heading(
      "Visão geral",
      "Acompanhe as conversas e mantenha sua equipe em sintonia.",
      `<button class="secondary" data-nav="reports">Ver relatórios ↗</button><button class="primary" data-action="new-contact">＋ Novo contato</button>`,
    ) +
    `<section class="welcome-banner"><div><h2>Olá, ${escape(state.user.name.split(" ")[0])}. Vamos conectar?</h2><p>Seu próximo bom atendimento começa com uma conversa.</p></div><span class="banner-art" aria-hidden="true">↗</span></section>` +
    stats(report) +
    `<div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Atendimentos recentes</h2><p>Um olhar sobre suas últimas conversas</p></div><button class="text-button" data-nav="inbox">Ver todos →</button></div>${reportTable(report.rows.slice(0, 5))}</section><section class="panel"><div class="panel-head"><div><h2>Por departamento</h2><p>Distribuição dos atendimentos</p></div>${icon("departments").replace("<svg", '<svg width="18" height="18"')}</div>${bars(report)}<div class="panel-foot">${report.averageResponseMinutes === null ? "Tempo de primeira resposta disponível após o primeiro envio." : `Primeira resposta média: ${report.averageResponseMinutes} min`}</div></section></div>`;
}
function renderContacts() {
  $("#main").innerHTML =
    heading(
      "Contatos",
      "Conheça as pessoas por trás de cada conversa.",
      `<button class="primary" data-action="new-contact">＋ Novo contato</button>`,
    ) +
    `<div class="filters"><input id="contactSearch" type="search" placeholder="Buscar nome, telefone ou empresa" aria-label="Buscar contatos"></div><section class="panel" id="contactTable"></section>`;
  drawContacts();
  $("#contactSearch").oninput = drawContacts;
}
function drawContacts() {
  const query = $("#contactSearch").value.toLowerCase();
  const rows = state.contacts.filter((c) =>
    `${c.name} ${c.phone} ${c.company}`.toLowerCase().includes(query),
  );
  $("#contactTable").innerHTML = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Contato</th><th>Empresa</th><th>Departamento</th><th>E-mail</th><th>Ações</th></tr></thead><tbody>${rows.map((c) => `<tr><td>${person(c.name, "+" + c.phone)}</td><td>${escape(c.company || "—")}</td><td><span class="badge">${escape(departmentName(c.department_id))}</span></td><td>${escape(c.email || "—")}</td><td><button class="text-button" data-edit-contact="${c.id}">Editar</button></td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "Nenhum contato encontrado",
        "Cadastre um cliente ou aguarde uma mensagem no WhatsApp.",
      );
}
function contactModal(contact = {}) {
  modal(
    contact.id ? "Editar contato" : "Novo contato",
    field(
      "Nome completo",
      "name",
      contact.name,
      "text",
      'required maxlength="120"',
    ) +
      `<div class="form-grid">${field("WhatsApp com país e DDD", "phone", contact.phone, "tel", 'required placeholder="5579999999999" maxlength="30"')}${field("E-mail", "email", contact.email, "email", 'maxlength="200"')}</div>` +
      field("Empresa", "company", contact.company, "text", 'maxlength="150"') +
      (state.user.role === "admin"
        ? `<label>Departamento<select aria-label="Departamento" name="department_id">${departmentOptions(contact.department_id, true)}</select></label>`
        : "") +
      `<label>Observações<textarea name="notes" maxlength="3000">${escape(contact.notes)}</textarea></label>`,
    async (data) => {
      await api(
        "/contacts" + (contact.id ? "/" + contact.id : ""),
        contact.id ? "PATCH" : "POST",
        data,
      );
      await navigate("contacts");
    },
  );
}
function renderDepartments() {
  $("#main").innerHTML =
    heading(
      "Departamentos",
      "Organize sua operação e direcione cada conversa à equipe certa.",
      `<button class="primary" data-action="new-department">＋ Novo departamento</button>`,
    ) +
    (state.departments.length
      ? `<div class="grid-cards">${state.departments.map((d) => `<article class="panel department-card"><div class="dept-icon">${icon("departments")}</div><h2>${escape(d.name)}</h2><p>${escape(d.description || "Equipe de atendimento")}</p><div class="card-foot"><span class="badge ${d.active ? "" : "inactive"}">● ${d.active ? "Disponível no bot" : "Inativo"}</span><button class="text-button" data-edit-department="${d.id}">Gerenciar →</button></div></article>`).join("")}</div>`
      : empty(
          "Dê um lugar para cada equipe",
          "Comece cadastrando Financeiro, Comercial ou Suporte.",
        ));
}
function departmentModal(department = {}) {
  modal(
    department.id ? "Editar departamento" : "Novo departamento",
    field(
      "Nome do departamento",
      "name",
      department.name,
      "text",
      'required maxlength="80"',
    ) +
      `<label>Descrição<textarea name="description" maxlength="300">${escape(department.description)}</textarea></label>` +
      (department.id
        ? `<label class="check-label"><input name="active" type="checkbox" ${department.active ? "checked" : ""}> Ativo e disponível no menu do bot</label>`
        : ""),
    async (data) => {
      await api(
        "/departments" + (department.id ? "/" + department.id : ""),
        department.id ? "PATCH" : "POST",
        { ...data, active: Boolean(data.active) },
      );
      await navigate("departments");
    },
  );
}
function renderUsers() {
  $("#main").innerHTML =
    heading(
      "Sua equipe",
      "Pessoas certas, acessos organizados e atendimento próximo.",
      `<button class="primary" data-action="new-user">＋ Cadastrar usuário</button>`,
    ) +
    `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Departamento</th><th>Permissão</th><th>Status</th><th>Ações</th></tr></thead><tbody>${state.users.map((u) => `<tr><td>${person(u.name, u.email)}</td><td>${escape(departmentName(u.department_id))}</td><td>${u.role === "admin" ? "Administrador" : "Atendente"}</td><td><span class="badge ${u.active ? "" : "inactive"}">${u.active ? "Ativo" : "Inativo"}</span></td><td><div class="inline-actions"><button class="text-button" data-edit-user="${escape(u.id)}">Editar</button><button class="text-button" data-reset-user="${escape(u.id)}">Redefinir senha</button></div></td></tr>`).join("")}</tbody></table></div></section>`;
}
function userModal(user = {}) {
  modal(
    user.id ? "Editar usuário" : "Cadastrar usuário",
    field(
      "Nome completo",
      "name",
      user.name,
      "text",
      'required maxlength="100"',
    ) +
      (!user.id
        ? field("E-mail de acesso", "email", "", "email", "required") +
          field(
            "Senha inicial (mínimo 12 caracteres)",
            "password",
            "",
            "password",
            'required minlength="12" maxlength="128" autocomplete="new-password"',
          )
        : "") +
      `<div class="form-grid"><label>Permissão<select aria-label="Permissão" name="role"><option value="agent" ${user.role !== "admin" ? "selected" : ""}>Atendente</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrador</option></select></label><label>Departamento<select aria-label="Departamento" name="department_id">${departmentOptions(user.department_id, true)}</select></label></div><small>Atendentes acessam somente o próprio departamento. Administradores acessam todos.</small>` +
      (user.id
        ? `<label class="check-label"><input name="active" type="checkbox" ${user.active ? "checked" : ""}> Conta ativa</label>`
        : ""),
    async (data) => {
      await api(
        "/users" + (user.id ? "/" + user.id : ""),
        user.id ? "PATCH" : "POST",
        { ...data, active: Boolean(data.active) },
      );
      if (user.id === state.user.id) {
        showLogin();
        toast("Conta atualizada. Entre novamente.");
      } else await navigate("users");
    },
  );
}
function renderInbox() {
  $("#main").innerHTML =
    heading(
      "Atendimentos",
      "Conversas conectadas. Atendimento com contexto.",
      `<button class="secondary" data-action="refresh-inbox">↻ Atualizar</button>`,
    ) +
    `<section class="panel inbox ${state.selected ? "has-selection" : ""}"><div class="thread-list"><div class="inbox-filter"><input id="threadSearch" type="search" value="${escape(state.search)}" placeholder="Buscar conversa" aria-label="Buscar conversa"><select id="threadFilter" aria-label="Filtrar atendimentos">${[
      ["open", "Em aberto"],
      ["waiting", "Na fila"],
      ["active", "Em atendimento"],
      ["closed", "Resolvidos"],
      ["all", "Todos"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${state.filter === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div><div id="threads"></div></div><div class="chat" id="chat">${empty("Escolha uma conversa", "O histórico e as ações de atendimento aparecerão aqui.")}</div></section>`;
  drawThreads();
  $("#threadSearch").oninput = (e) => {
    state.search = e.target.value;
    drawThreads();
  };
  $("#threadFilter").onchange = (e) => {
    state.filter = e.target.value;
    drawThreads();
  };
  if (state.selected) openChat(state.selected);
}
function drawThreads() {
  const rows = state.conversations.filter(
    (c) =>
      (state.filter === "all" ||
        (state.filter === "open"
          ? c.status !== "closed"
          : c.status === state.filter)) &&
      `${c.name} ${c.phone}`.toLowerCase().includes(state.search.toLowerCase()),
  );
  $("#threads").innerHTML = rows.length
    ? rows
        .map(
          (c) =>
            `<button class="thread ${c.id === state.selected ? "selected" : ""}" data-thread="${c.id}"><span class="avatar">${initials(c.name)}</span><div><strong>${escape(c.name)}</strong><p>${escape(c.preview || "Nova conversa")}</p><div class="thread-meta"><small>${escape(c.department_name || "Triagem")}</small>${badge(c.status)}</div></div></button>`,
        )
        .join("")
    : empty("Tudo tranquilo por aqui", "Nenhum atendimento neste filtro.");
}
async function openChat(conversationId) {
  const c = state.conversations.find((item) => item.id === conversationId);
  if (!c) {
    state.selected = null;
    return;
  }
  state.selected = conversationId;
  drawThreads();
  $(".inbox").classList.add("has-selection");
  $("#chat").innerHTML =
    `<div class="chat-head"><div class="person"><button class="icon-button mobile-back" data-action="back-threads" aria-label="Voltar às conversas">←</button><span class="avatar">${initials(c.name)}</span><div><strong>${escape(c.name)}</strong><small>+${escape(c.phone)} · ${escape(c.department_name || "Triagem")} · ${escape(c.assignee_name || "Sem responsável")}</small></div></div><div class="chat-tools">${c.status !== "closed" ? `${!c.assignee ? '<button class="secondary" data-action="claim">Assumir</button>' : ""}<button class="secondary" data-action="transfer">Transferir</button><button class="secondary" data-action="close-conversation">✓ Resolver</button>` : badge("closed")}</div></div><div id="messages" class="chat-body" aria-live="polite"></div>${c.status !== "closed" ? '<form id="messageForm" class="compose"><div class="compose-row"><textarea name="body" required maxlength="4000" aria-label="Mensagem" placeholder="Escreva sua mensagem…"></textarea><button class="primary" type="submit">Enviar ↗</button></div><label><input type="checkbox" name="note"> Nota interna — visível apenas à equipe</label><small>Respostas no WhatsApp disponíveis até 24h após a última mensagem do cliente.</small><p id="sendError" class="error" role="alert"></p></form>' : ""}`;
  if ($("#messageForm"))
    $("#messageForm").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        button = form.querySelector("button");
      button.disabled = true;
      $("#sendError").textContent = "";
      try {
        const data = Object.fromEntries(new FormData(form));
        await api(`/conversations/${c.id}/messages`, "POST", {
          body: data.body,
          note: Boolean(data.note),
        });
        form.elements.body.value = "";
        await refreshMessages(c.id, true);
      } catch (error) {
        if ($("#sendError")) $("#sendError").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  try {
    await refreshMessages(c.id, true);
  } catch (error) {
    toast(error.message);
  }
}
async function refreshMessages(conversationId, force = false) {
  const messages = await api(`/conversations/${conversationId}/messages`);
  if (
    state.view !== "inbox" ||
    state.selected !== conversationId ||
    !$("#messages")
  )
    return;
  const box = $("#messages");
  const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const signature = messages
    .map((m) => `${m.id}:${m.status}:${m.error}`)
    .join("|");
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  box.innerHTML = messages
    .map(
      (m) =>
        `<div class="message ${escape(m.direction)}">${escape(m.body)}<small>${m.direction === "bot" ? "Bot · " : m.direction === "note" ? "Nota interna · " : ""}${formatDate(m.created_at)} · ${escape(statusLabels[m.status] || m.status)}</small>${m.error ? `<div class="error">${escape(m.error)}</div>` : ""}</div>`,
    )
    .join("");
  if (bottom || force) box.scrollTop = box.scrollHeight;
}
function renderReports() {
  $("#main").innerHTML =
    heading(
      "Relatórios",
      "Transforme o histórico de atendimento em uma visão da operação.",
      `<button class="secondary" data-action="export">↓ Exportar CSV</button>`,
    ) +
    `<form id="reportFilter" class="filters"><label>De <input type="date" name="start" aria-label="Data inicial"></label><label>Até <input type="date" name="end" aria-label="Data final"></label><button class="primary">Filtrar período</button></form><div id="reportContent"></div>`;
  drawReport();
  $("#reportFilter").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const params = new URLSearchParams(new FormData(e.currentTarget));
      state.report = await api("/reports?" + params);
      drawReport();
    } catch (error) {
      toast(error.message);
    }
  };
}
function drawReport() {
  $("#reportContent").innerHTML =
    stats(state.report) +
    `<div class="dashboard-grid"><section class="panel"><div class="panel-head"><h2>Atendimentos no período</h2></div>${reportTable(state.report.rows)}</section><section class="panel"><div class="panel-head"><h2>Distribuição por departamento</h2></div>${bars(state.report)}<div class="panel-foot">Primeira resposta humana média: ${state.report.averageResponseMinutes === null ? "sem dados" : state.report.averageResponseMinutes + " min"}. Período pela abertura do atendimento, horário de Brasília.</div></section></div>`;
}
function exportReport() {
  const cell = (value) =>
    '"' +
    String(value ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const rows = [
    [
      "Atendimento",
      "Cliente",
      "Departamento",
      "Status",
      "Responsável",
      "Abertura",
      "Encerramento",
    ],
    ...state.report.rows.map((r) => [
      r.id,
      r.name,
      r.department_name || "Triagem",
      statusLabels[r.status],
      r.assignee_name || "",
      formatDate(r.created_at),
      r.closed_at ? formatDate(r.closed_at) : "",
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "daegon-relatorio.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderBot(settings) {
  const active = state.departments.filter((d) => d.active);
  $("#main").innerHTML =
    heading(
      "Bot de atendimento",
      "Uma recepção simples, um direcionamento inteligente.",
    ) +
    `<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>Recepção e direcionamento</h2></div><form id="botForm" class="panel-content"><label class="check-label"><input name="bot_enabled" type="checkbox" ${settings.bot_enabled ? "checked" : ""}> Ativar menu automático</label><label>Mensagem de boas-vindas<textarea name="greeting" required maxlength="1000" rows="4">${escape(settings.greeting)}</textarea></label><p>O menu usa os departamentos ativos na ordem de cadastro. Após a escolha, o bot dá lugar à equipe.</p><div class="bot-flow"><span>Mensagem recebida</span>→<span>Menu de setores</span>→<span>Fila da equipe</span></div><button class="primary">Salvar configuração</button><p id="botError" role="alert" class="error"></p></form></section><section class="panel"><div class="panel-head"><h2>Prévia do menu</h2><span class="badge">WhatsApp</span></div><div class="panel-content"><div class="bot-preview" id="botPreview"></div><p>Sem setores ativos, a conversa fica em Triagem para o administrador. O menu é textual e aceita o número escolhido.</p></div></section></div>`;
  const preview = () => {
    $("#botPreview").textContent =
      $("#botForm").elements.greeting.value +
      "\n\n" +
      active.map((d, i) => `${i + 1} — ${d.name}`).join("\n") +
      "\n\nResponda com o número do departamento.";
  };
  preview();
  $("#botForm").elements.greeting.oninput = preview;
  $("#botForm").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/settings", "PUT", {
        greeting: data.greeting,
        bot_enabled: Boolean(data.bot_enabled),
      });
      toast("Configuração do bot salva.");
    } catch (error) {
      $("#botError").textContent = error.message;
    }
  };
}
function renderSettings(settings) {
  $("#main").innerHTML =
    heading("WhatsApp API", "Conecte sua operação à API oficial da Meta.") +
    `<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>WhatsApp Business Cloud API</h2><span class="badge ${settings.whatsapp.configured ? "" : "waiting"}">${settings.whatsapp.configured ? "Configurada" : "Configuração pendente"}</span></div><div class="panel-content"><div class="connection"><b>${settings.whatsapp.configured ? "Credenciais presentes no servidor" : "Complete a configuração no servidor"}</b>${settings.whatsapp.configured ? "A presença das credenciais não confirma a validade do token. O primeiro envio e os eventos recebidos confirmarão a conexão." : `Variáveis pendentes: <code>${escape(settings.whatsapp.missing.join(", "))}</code>`}</div><label>URL de callback<input readonly value="${escape(settings.webhook)}"></label><p>Cadastre essa URL no aplicativo da Meta e assine o campo <b>messages</b>. Use o mesmo token de verificação configurado no servidor.</p><p>Phone Number ID: <b>${escape(settings.whatsapp.phoneNumberId || "Não configurado")}</b></p><button class="secondary" data-action="refresh-settings">↻ Verificar configuração</button></div></section><section class="panel"><div class="panel-head"><h2>Antes de começar</h2></div><div class="panel-content"><h3>1. Prepare sua conta Meta</h3><p>Você precisa de um aplicativo com WhatsApp Business, número habilitado e token com permissão de mensagens.</p><h3>2. Configure o servidor</h3><p>Adicione as credenciais no arquivo de ambiente. O endereço público do CRM precisa usar HTTPS para receber os eventos.</p><h3>3. Cadastre sua equipe</h3><p>Crie departamentos e associe os atendentes. Ative o bot para oferecer essas opções aos clientes.</p><small>Esta versão envia texto e recebe notificações de mídia. Envio de anexos e modelos fora da janela de 24h não estão incluídos.</small></div></section></div>`;
}
function modal(title, fields, onSave) {
  $("#modalTitle").textContent = title;
  $("#modalFields").innerHTML = fields;
  $("#modalError").textContent = "";
  $("#modal").showModal();
  $("#modalForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await onSave(Object.fromEntries(new FormData(e.currentTarget)));
      $("#modal").close();
      toast("Alterações salvas.");
    } catch (error) {
      $("#modalError").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
$("#closeModal").onclick = $("#cancelModal").onclick = () =>
  $("#modal").close();
$("#menuBtn").onclick = () => {
  const open = $("#sidebar").classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded", String(open));
};
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  $("#loginError").textContent = "";
  try {
    await api(
      "/auth/sign-in/email",
      "POST",
      Object.fromEntries(new FormData(e.currentTarget)),
    );
    e.target.elements.password.value = "";
    await boot();
  } catch (error) {
    $("#loginError").textContent =
      "Não foi possível entrar. Confira suas credenciais ou tente novamente em instantes.";
  } finally {
    button.disabled = false;
  }
};
$("#logoutBtn").onclick = async () => {
  try {
    await api("/auth/sign-out", "POST", {});
    showLogin();
  } catch (error) {
    toast(error.message);
  }
};
$("#accountBtn").onclick = () =>
  modal(
    "Alterar minha senha",
    field(
      "Senha atual",
      "currentPassword",
      "",
      "password",
      'required autocomplete="current-password"',
    ) +
      field(
        "Nova senha",
        "newPassword",
        "",
        "password",
        'required minlength="12" maxlength="128" autocomplete="new-password"',
      ),
    async (data) => {
      await api("/auth/change-password", "POST", {
        ...data,
        revokeOtherSessions: true,
      });
    },
  );
async function action(name) {
  if (name === "new-contact") {
    contactModal();
    return;
  }
  if (name === "new-department") {
    departmentModal();
    return;
  }
  if (name === "new-user") {
    userModal();
    return;
  }
  if (name === "export") {
    exportReport();
    return;
  }
  if (name === "refresh-settings") {
    await navigate("settings");
    return;
  }
  if (name === "refresh-inbox") {
    await navigate("inbox");
    return;
  }
  if (name === "back-threads") {
    state.selected = null;
    $(".inbox").classList.remove("has-selection");
    drawThreads();
    return;
  }
  if (name === "transfer") {
    modal(
      "Transferir atendimento",
      `<label>Departamento de destino<select aria-label="Departamento" name="department_id" required>${departmentOptions(null)}</select></label><p>O atendimento ficará disponível para a equipe do setor selecionado.</p>`,
      async (data) => {
        await api(`/conversations/${state.selected}`, "PATCH", {
          action: "transfer",
          department_id: data.department_id,
        });
        state.selected = null;
        await navigate("inbox");
      },
    );
    return;
  }
  if (name === "claim") {
    await api(`/conversations/${state.selected}`, "PATCH", { action: "claim" });
    await navigate("inbox");
    return;
  }
  if (name === "close-conversation") {
    modal(
      "Resolver atendimento",
      "<p>O histórico será preservado. Uma nova mensagem do cliente iniciará um novo atendimento.</p>",
      async () => {
        await api(`/conversations/${state.selected}`, "PATCH", {
          action: "close",
        });
        await navigate("inbox");
      },
    );
  }
}
document.addEventListener("click", async (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  try {
    if (button.dataset.nav) await navigate(button.dataset.nav);
    if (button.dataset.action) await action(button.dataset.action);
    if (button.dataset.editContact)
      contactModal(
        state.contacts.find((c) => c.id === Number(button.dataset.editContact)),
      );
    if (button.dataset.editDepartment)
      departmentModal(
        state.departments.find(
          (d) => d.id === Number(button.dataset.editDepartment),
        ),
      );
    if (button.dataset.editUser)
      userModal(state.users.find((u) => u.id === button.dataset.editUser));
    if (button.dataset.resetUser)
      modal(
        "Redefinir senha",
        field(
          "Nova senha (mínimo 12 caracteres)",
          "password",
          "",
          "password",
          'required minlength="12" maxlength="128"',
        ),
        async (data) => {
          await api(
            `/users/${button.dataset.resetUser}/password`,
            "POST",
            data,
          );
        },
      );
    if (button.dataset.thread) await openChat(Number(button.dataset.thread));
  } catch (error) {
    toast(error.message);
  }
});
setInterval(async () => {
  if (
    polling ||
    !state.user ||
    state.view !== "inbox" ||
    document.hidden ||
    $("#modal").open
  )
    return;
  polling = true;
  const version = renderVersion;
  try {
    const conversations = await api("/conversations");
    if (version !== renderVersion || state.view !== "inbox") return;
    const previous = state.conversations.find((c) => c.id === state.selected);
    state.conversations = conversations;
    drawThreads();
    const current = conversations.find((c) => c.id === state.selected);
    if (state.selected && !current) {
      state.selected = null;
      renderInbox();
    } else if (current) {
      if (
        previous?.status !== current.status ||
        previous?.assignee !== current.assignee ||
        previous?.department_id !== current.department_id
      )
        await openChat(current.id);
      else await refreshMessages(current.id);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    polling = false;
  }
}, 5000);
boot();
