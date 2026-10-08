import express from "express";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { resolve } from "node:path";
import { audit, transaction } from "./db.js";
import { configuration, validSignature, ingest, enqueue } from "./whatsapp.js";

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = (value, label, max = 200, required = true) => {
  if (
    typeof value !== "string" ||
    (required && !value.trim()) ||
    value.trim().length > max
  )
    fail(400, `${label}: valor inválido (máximo ${max} caracteres).`);
  return value.trim();
};
const id = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) fail(400, "Identificador inválido.");
  return n;
};

export function createApp(db, auth, env = process.env) {
  const app = express();
  app.disable("x-powered-by");
  if (env.TRUST_PROXY === "loopback") app.set("trust proxy", "loopback");
  app.use((req, res, next) => {
    req.headers["x-daegon-client-ip"] = req.ip;
    next();
  });
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/whatsapp/webhook", (req, res) => {
    if (
      env.WHATSAPP_VERIFY_TOKEN &&
      req.query["hub.mode"] === "subscribe" &&
      req.query["hub.verify_token"] === env.WHATSAPP_VERIFY_TOKEN
    )
      return res.type("text").send(String(req.query["hub.challenge"] || ""));
    res.sendStatus(403);
  });
  app.post(
    "/api/whatsapp/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res) => {
      if (
        !Buffer.isBuffer(req.body) ||
        !validSignature(
          req.body,
          req.headers["x-hub-signature-256"],
          env.META_APP_SECRET,
        )
      )
        return res.sendStatus(401);
      let payload;
      try {
        payload = JSON.parse(req.body.toString());
      } catch {
        return res.sendStatus(400);
      }
      if (payload.object !== "whatsapp_business_account")
        return res.sendStatus(400);
      ingest(db, payload, env);
      res.sendStatus(200);
    },
  );
  // Account provisioning and admin operations use the restricted CRM routes below.
  app.all("/api/auth/{*path}", (req, res, next) => {
    if (
      ![
        "/api/auth/sign-in/email",
        "/api/auth/sign-out",
        "/api/auth/get-session",
        "/api/auth/change-password",
        "/api/auth/ok",
      ].includes(req.path)
    )
      return res.sendStatus(404);
    return toNodeHandler(auth)(req, res, next);
  });
  app.use("/api", express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin !== (env.APP_URL || "http://localhost:3000")
    )
      return res
        .status(403)
        .json({ error: "Origem da solicitação não autorizada." });
    next();
  });
  app.use("/api", async (req, res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session)
      return res
        .status(401)
        .json({ error: "Entre na sua conta para continuar." });
    const staff = db
      .prepare("SELECT * FROM staff WHERE user_id=? AND active=1")
      .get(session.user.id);
    if (!staff)
      return res
        .status(403)
        .json({ error: "Sua conta não possui acesso ativo ao CRM." });
    req.user = { ...session.user, ...staff };
    next();
  });
  const admin = (req, res, next) =>
    req.user.role === "admin"
      ? next()
      : res
          .status(403)
          .json({ error: "Apenas administradores podem realizar esta ação." });
  const dept = (value, required = true) => {
    if (!value && !required) return null;
    const item = db
      .prepare("SELECT * FROM departments WHERE id=? AND active=1")
      .get(id(value));
    if (!item) fail(400, "Selecione um departamento ativo.");
    return item.id;
  };
  const scoped = (req, column = "department_id") =>
    req.user.role === "admin"
      ? { sql: "1=1", params: [] }
      : { sql: `${column}=?`, params: [req.user.department_id ?? -1] };
  const conversation = (req) => {
    const scope = scoped(req);
    const item = db
      .prepare(`SELECT * FROM conversations WHERE id=? AND ${scope.sql}`)
      .get(id(req.params.id), ...scope.params);
    if (!item) fail(404, "Atendimento não encontrado.");
    return item;
  };
  app.get("/api/me", (req, res) =>
    res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      department_id: req.user.department_id,
    }),
  );
  app.get("/api/departments", (req, res) =>
    res.json(
      db
        .prepare(
          req.user.role === "admin"
            ? "SELECT * FROM departments ORDER BY id"
            : "SELECT * FROM departments WHERE active=1 ORDER BY id",
        )
        .all(),
    ),
  );
  app.post("/api/departments", admin, (req, res) => {
    const result = db
      .prepare("INSERT INTO departments(name,description) VALUES(?,?)")
      .run(
        text(req.body.name, "Nome", 80),
        text(req.body.description ?? "", "Descrição", 300, false),
      );
    audit(db, req.user.id, "Departamento criado");
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  app.patch("/api/departments/:id", admin, (req, res) => {
    const department = id(req.params.id);
    if (!db.prepare("SELECT id FROM departments WHERE id=?").get(department))
      fail(404, "Departamento não encontrado.");
    if (
      !req.body.active &&
      (db
        .prepare("SELECT user_id FROM staff WHERE department_id=? AND active=1")
        .get(department) ||
        db
          .prepare(
            "SELECT id FROM conversations WHERE department_id=? AND status!='closed'",
          )
          .get(department))
    )
      fail(
        409,
        "Transfira os usuários e atendimentos abertos antes de desativar o departamento.",
      );
    db.prepare(
      "UPDATE departments SET name=?,description=?,active=? WHERE id=?",
    ).run(
      text(req.body.name, "Nome", 80),
      text(req.body.description ?? "", "Descrição", 300, false),
      req.body.active ? 1 : 0,
      department,
    );
    audit(db, req.user.id, `Departamento ${department} atualizado`);
    res.json({ ok: true });
  });
  app.get("/api/users", admin, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT u.id,u.name,u.email,s.role,s.department_id,s.active FROM user u JOIN staff s ON s.user_id=u.id ORDER BY u.name",
        )
        .all(),
    ),
  );
  app.post("/api/users", admin, async (req, res) => {
    const role = req.body.role === "admin" ? "admin" : "agent";
    const department = dept(req.body.department_id, role !== "admin");
    const result = await auth.api.createUser({
      body: {
        name: text(req.body.name, "Nome", 100),
        email: text(req.body.email, "E-mail", 200),
        password: text(req.body.password, "Senha", 128),
        role: role === "admin" ? "admin" : "user",
      },
    });
    db.prepare(
      "INSERT INTO staff(user_id,role,department_id) VALUES(?,?,?)",
    ).run(result.user.id, role, department);
    audit(db, req.user.id, `Conta ${result.user.id} criada`);
    res.status(201).json({ id: result.user.id });
  });
  app.patch("/api/users/:id", admin, (req, res) => {
    const user = db
      .prepare("SELECT * FROM staff WHERE user_id=?")
      .get(req.params.id);
    if (!user) fail(404, "Conta não encontrada.");
    const role = req.body.role === "admin" ? "admin" : "agent",
      active = req.body.active ? 1 : 0;
    if (user.user_id === req.user.id && (!active || role !== "admin"))
      fail(
        409,
        "Você não pode desativar ou remover o próprio acesso de administrador.",
      );
    const department = dept(req.body.department_id, role !== "admin");
    transaction(db, () => {
      db.prepare(
        "UPDATE staff SET role=?,department_id=?,active=? WHERE user_id=?",
      ).run(role, department, active, user.user_id);
      db.prepare("UPDATE user SET name=?,role=? WHERE id=?").run(
        text(req.body.name, "Nome", 100),
        role === "admin" ? "admin" : "user",
        user.user_id,
      );
      db.prepare("DELETE FROM session WHERE userId=?").run(user.user_id);
      db.prepare(
        "UPDATE conversations SET assignee=NULL,status=CASE WHEN status='active' THEN 'waiting' ELSE status END WHERE assignee=?",
      ).run(user.user_id);
      audit(db, req.user.id, `Conta ${user.user_id} atualizada`);
    });
    res.json({ ok: true });
  });
  app.post("/api/users/:id/password", admin, async (req, res) => {
    if (
      !db
        .prepare("SELECT user_id FROM staff WHERE user_id=?")
        .get(req.params.id)
    )
      fail(404, "Conta não encontrada.");
    await auth.api.setUserPassword({
      headers: fromNodeHeaders(req.headers),
      body: {
        userId: req.params.id,
        newPassword: text(req.body.password, "Senha", 128),
      },
    });
    db.prepare("DELETE FROM session WHERE userId=?").run(req.params.id);
    audit(db, req.user.id, `Senha redefinida para ${req.params.id}`);
    res.json({ ok: true });
  });
  app.get("/api/contacts", (req, res) => {
    const scope = scoped(req);
    res.json(
      db
        .prepare(`SELECT * FROM contacts WHERE ${scope.sql} ORDER BY name`)
        .all(...scope.params),
    );
  });
  const contactInput = (req) => {
    const phone = text(req.body.phone, "Telefone", 30).replace(/[\s()+-]/g, "");
    if (!/^\d{8,15}$/.test(phone))
      fail(
        400,
        "Informe o telefone com código do país e DDD, somente números.",
      );
    const department =
      req.user.role === "admin"
        ? dept(req.body.department_id, false)
        : req.user.department_id;
    return [
      text(req.body.name, "Nome", 120),
      phone,
      text(req.body.email ?? "", "E-mail", 200, false),
      text(req.body.company ?? "", "Empresa", 150, false),
      text(req.body.notes ?? "", "Observações", 3000, false),
      department,
    ];
  };
  app.post("/api/contacts", (req, res) => {
    const result = db
      .prepare(
        "INSERT INTO contacts(name,phone,email,company,notes,department_id,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(...contactInput(req), Date.now());
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  app.patch("/api/contacts/:id", (req, res) => {
    const scope = scoped(req),
      contact = id(req.params.id);
    const existing = db
      .prepare(`SELECT * FROM contacts WHERE id=? AND ${scope.sql}`)
      .get(contact, ...scope.params);
    if (!existing) fail(404, "Contato não encontrado.");
    const values = contactInput(req);
    if (
      values[1] !== existing.phone &&
      db.prepare("SELECT id FROM conversations WHERE contact_id=?").get(contact)
    )
      fail(
        409,
        "Este número possui histórico. Cadastre um novo contato para outro número.",
      );
    if (
      values[5] !== existing.department_id &&
      db
        .prepare(
          "SELECT id FROM conversations WHERE contact_id=? AND status!='closed'",
        )
        .get(contact)
    )
      fail(
        409,
        "Use Transferir no atendimento para alterar o departamento deste contato.",
      );
    db.prepare(
      "UPDATE contacts SET name=?,phone=?,email=?,company=?,notes=?,department_id=? WHERE id=?",
    ).run(...values, contact);
    res.json({ ok: true });
  });
  app.get("/api/conversations", (req, res) => {
    const scope = scoped(req, "c.department_id");
    res.json(
      db
        .prepare(
          `SELECT c.*,p.name,p.phone,d.name AS department_name,u.name AS assignee_name,
      (SELECT body FROM messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS preview
      FROM conversations c JOIN contacts p ON p.id=c.contact_id LEFT JOIN departments d ON d.id=c.department_id LEFT JOIN user u ON u.id=c.assignee WHERE ${scope.sql} ORDER BY c.updated_at DESC`,
        )
        .all(...scope.params),
    );
  });
  app.get("/api/conversations/:id/messages", (req, res) => {
    const c = conversation(req);
    res.json(
      db
        .prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY id")
        .all(c.id),
    );
  });
  app.post("/api/conversations/:id/messages", (req, res) => {
    const c = conversation(req);
    if (c.status === "closed") fail(409, "Este atendimento foi encerrado.");
    const body = text(req.body.body, "Mensagem", 4000);
    if (req.body.note) {
      db.prepare(
        "INSERT INTO messages(conversation_id,direction,body,sender,status,created_at) VALUES(?,'note',?,?,'internal',?)",
      ).run(c.id, body, req.user.id, Date.now());
    } else {
      if (!configuration(env).configured)
        fail(
          409,
          "Configure a integração com a Meta antes de enviar mensagens.",
        );
      if (!c.last_inbound || Date.now() - c.last_inbound >= 86400000)
        fail(
          409,
          "Janela de 24 horas encerrada. Aguarde nova mensagem do cliente.",
        );
      if (req.user.role !== "admin" && c.assignee !== req.user.id)
        fail(409, "Assuma o atendimento antes de responder.");
      enqueue(db, c.id, body, "out", req.user.id);
    }
    db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(
      Date.now(),
      c.id,
    );
    res.status(201).json({ ok: true });
  });
  app.patch("/api/conversations/:id", (req, res) => {
    const c = conversation(req);
    if (req.body.action === "claim") {
      if (c.status === "closed" || (c.assignee && c.assignee !== req.user.id))
        fail(409, "Atendimento encerrado ou já assumido por outro usuário.");
      db.prepare(
        "UPDATE conversations SET assignee=?,status='active',updated_at=? WHERE id=?",
      ).run(req.user.id, Date.now(), c.id);
    } else if (req.body.action === "close") {
      if (c.status === "closed") fail(409, "Atendimento já encerrado.");
      db.prepare(
        "UPDATE conversations SET status='closed',closed_at=?,updated_at=? WHERE id=?",
      ).run(Date.now(), Date.now(), c.id);
    } else if (req.body.action === "transfer") {
      if (c.status === "closed")
        fail(409, "Não é possível transferir um atendimento encerrado.");
      const department = dept(req.body.department_id);
      transaction(db, () => {
        db.prepare(
          "UPDATE conversations SET department_id=?,assignee=NULL,status='waiting',updated_at=? WHERE id=?",
        ).run(department, Date.now(), c.id);
        db.prepare("UPDATE contacts SET department_id=? WHERE id=?").run(
          department,
          c.contact_id,
        );
      });
    } else fail(400, "Ação inválida.");
    audit(db, req.user.id, `Atendimento ${c.id}: ${req.body.action}`);
    res.json({ ok: true });
  });
  app.get("/api/settings", admin, (req, res) =>
    res.json({
      ...db.prepare("SELECT * FROM settings WHERE id=1").get(),
      whatsapp: configuration(env),
      webhook: `${env.APP_URL || "http://localhost:3000"}/api/whatsapp/webhook`,
    }),
  );
  app.put("/api/settings", admin, (req, res) => {
    db.prepare("UPDATE settings SET bot_enabled=?,greeting=? WHERE id=1").run(
      req.body.bot_enabled ? 1 : 0,
      text(req.body.greeting, "Saudação", 1000),
    );
    audit(db, req.user.id, "Bot atualizado");
    res.json({ ok: true });
  });
  app.get("/api/reports", (req, res) => {
    const scope = scoped(req, "c.department_id");
    const start = req.query.start
      ? Date.parse(`${req.query.start}T00:00:00-03:00`)
      : 0;
    const end = req.query.end
      ? Date.parse(`${req.query.end}T23:59:59.999-03:00`)
      : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
      fail(400, "Período inválido.");
    const rows = db
      .prepare(
        `SELECT c.*,p.name,d.name AS department_name,u.name AS assignee_name FROM conversations c JOIN contacts p ON p.id=c.contact_id LEFT JOIN departments d ON d.id=c.department_id LEFT JOIN user u ON u.id=c.assignee WHERE ${scope.sql} AND c.created_at BETWEEN ? AND ? ORDER BY c.created_at DESC`,
      )
      .all(...scope.params, start, end);
    const groups = {};
    for (const row of rows) {
      const key = row.department_name || "Triagem";
      groups[key] ??= { name: key, total: 0, closed: 0 };
      groups[key].total++;
      if (row.status === "closed") groups[key].closed++;
    }
    const answered = rows.filter((r) => r.first_response);
    res.json({
      total: rows.length,
      waiting: rows.filter((r) => r.status === "waiting").length,
      active: rows.filter((r) => r.status === "active").length,
      closed: rows.filter((r) => r.status === "closed").length,
      averageResponseMinutes: answered.length
        ? Math.round(
            answered.reduce(
              (sum, r) => sum + (r.first_response - r.created_at) / 60000,
              0,
            ) / answered.length,
          )
        : null,
      departments: Object.values(groups),
      rows,
    });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Recurso não encontrado." }),
  );
  const root = resolve(import.meta.dirname, "..");
  for (const [route, file] of [
    ["/", "index.html"],
    ["/app.js", "app.js"],
    ["/styles.css", "styles.css"],
    ["/favicon.svg", "favicon.svg"],
    ["/manifest.webmanifest", "manifest.webmanifest"],
  ])
    app.get(route, (req, res) => res.sendFile(resolve(root, file)));
  app.use((error, req, res, next) => {
    const duplicate = /UNIQUE constraint/.test(error.message);
    const status =
      typeof error.status === "number"
        ? error.status
        : typeof error.statusCode === "number"
          ? error.statusCode
          : duplicate
            ? 409
            : 500;
    if (status === 500) console.error("Request failed:", error.message);
    res.status(status).json({
      error: duplicate
        ? "Já existe um cadastro com esse nome, telefone ou e-mail."
        : status === 500
          ? "Não foi possível concluir a operação."
          : error.message,
    });
  });
  return app;
}
