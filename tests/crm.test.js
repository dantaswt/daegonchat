import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { openDatabase } from "../server/db.js";
import { createAuth } from "../server/auth.js";
import { createApp } from "../server/app.js";
import { makeWorker, validSignature, ingest } from "../server/whatsapp.js";

test("CRM: autenticação, cadastros, isolamento, bot, envio e relatórios", async (t) => {
  const db = openDatabase(":memory:");
  const env = {
    APP_URL: "http://localhost:3199",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    WHATSAPP_ACCESS_TOKEN: "fake-token",
    WHATSAPP_PHONE_NUMBER_ID: "12345",
    WHATSAPP_VERIFY_TOKEN: "test-verify",
    META_APP_SECRET: "test-app-secret",
    META_GRAPH_VERSION: "v25.0",
  };
  const auth = await createAuth(db, env);
  const admin = await auth.api.createUser({
    body: {
      email: "admin@example.test",
      password: "Test-admin-password-123",
      name: "Administrador",
      role: "admin",
    },
  });
  db.prepare("INSERT INTO staff(user_id,role) VALUES(?,'admin')").run(
    admin.user.id,
  );
  const server = createApp(db, auth, env).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.close();
    db.close();
  });
  async function request(path, method = "GET", body, cookie = "") {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: env.APP_URL,
        "Content-Type": "application/json",
        cookie,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    };
  }
  async function login(email, password) {
    const r = await request("/auth/sign-in/email", "POST", { email, password });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.cookie;
  }
  const adminCookie = await login(
    "admin@example.test",
    "Test-admin-password-123",
  );
  let finance, sales, financeUser, financeCookie, salesCookie, conversation;
  const webhook = (messageId, body, from = "5579999999999") => ({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID },
              contacts: [{ wa_id: from, profile: { name: "Cliente Teste" } }],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  async function sendWebhook(payload, signed = true) {
    const raw = JSON.stringify(payload);
    return fetch(base + "/api/whatsapp/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signed
          ? "sha256=" +
            createHmac("sha256", env.META_APP_SECRET).update(raw).digest("hex")
          : "bad",
      },
      body: raw,
    });
  }
  await t.test("login obrigatório e bloqueio de cadastro público", async () => {
    assert.equal((await request("/contacts")).status, 401);
    assert.equal(
      (
        await request("/auth/sign-up/email", "POST", {
          email: "x@y.com",
          password: "Test-password-123",
          name: "X",
        })
      ).status,
      404,
    );
    assert.equal(
      (await request("/auth/admin/create-user", "POST", {}, adminCookie))
        .status,
      404,
    );
    assert.equal(
      (await request("/me", "GET", null, adminCookie)).data.role,
      "admin",
    );
  });
  await t.test("cadastro de setores e contas com vínculo", async () => {
    finance = (
      await request(
        "/departments",
        "POST",
        { name: "Financeiro", description: "Contas e cobranças" },
        adminCookie,
      )
    ).data.id;
    sales = (
      await request(
        "/departments",
        "POST",
        { name: "Comercial", description: "Vendas" },
        adminCookie,
      )
    ).data.id;
    assert.ok(finance && sales);
    const user = await request(
      "/users",
      "POST",
      {
        name: "João Silva",
        email: "joao@example.test",
        password: "Test-finance-password",
        role: "agent",
        department_id: finance,
      },
      adminCookie,
    );
    assert.equal(user.status, 201, JSON.stringify(user.data));
    financeUser = user.data.id;
    assert.equal(
      (
        await request(
          "/users",
          "POST",
          {
            name: "Ana",
            email: "ana@example.test",
            password: "Test-sales-password",
            role: "agent",
            department_id: sales,
          },
          adminCookie,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await request(
          "/users",
          "POST",
          {
            name: "Sem setor",
            email: "none@example.test",
            password: "Test-missing-password",
            role: "agent",
          },
          adminCookie,
        )
      ).status,
      400,
    );
    financeCookie = await login("joao@example.test", "Test-finance-password");
    salesCookie = await login("ana@example.test", "Test-sales-password");
    assert.equal(
      (await request("/users", "GET", null, financeCookie)).status,
      403,
    );
    assert.equal(
      (await request("/settings", "GET", null, financeCookie)).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/departments",
          "POST",
          { name: "Não permitido" },
          financeCookie,
        )
      ).status,
      403,
    );
  });
  await t.test("cadastros persistidos e validação de contatos", async () => {
    assert.equal(
      (
        await request(
          "/contacts",
          "POST",
          {
            name: "Contato Financeiro",
            phone: "+55 (79) 98888-8888",
            department_id: sales,
          },
          financeCookie,
        )
      ).status,
      201,
    );
    const contacts = (await request("/contacts", "GET", null, financeCookie))
      .data;
    assert.equal(contacts[0].department_id, finance);
    assert.equal(contacts[0].phone, "5579988888888");
    assert.equal(
      (await request("/contacts", "GET", null, salesCookie)).data.length,
      0,
    );
    assert.equal(
      (
        await request(
          `/contacts/${contacts[0].id}`,
          "PATCH",
          { name: "Ataque", phone: "5579000000000" },
          salesCookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          "/contacts",
          "POST",
          { name: "Inválido", phone: "abc" },
          adminCookie,
        )
      ).status,
      400,
    );
  });
  await t.test("webhook valida assinatura, token e duplicatas", async () => {
    assert.equal(
      (
        await fetch(
          base +
            "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(
          base +
            "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong",
        )
      ).status,
      403,
    );
    assert.equal(
      (await sendWebhook(webhook("in-1", "Olá"), false)).status,
      401,
    );
    assert.equal((await sendWebhook(webhook("in-1", "Olá"))).status, 200);
    assert.equal((await sendWebhook(webhook("in-1", "Olá"))).status, 200);
    conversation = db.prepare("SELECT * FROM conversations").get();
    assert.ok(conversation);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages").get().n, 2);
    assert.match(
      db.prepare("SELECT body FROM messages WHERE direction='bot'").get().body,
      /1 — Financeiro/,
    );
    assert.equal(
      (await request("/conversations", "GET", null, financeCookie)).data.length,
      0,
    );
  });
  await t.test(
    "escolha encaminha ao Financeiro e bloqueia Comercial",
    async () => {
      await sendWebhook(webhook("in-2", "1"));
      const rows = (await request("/conversations", "GET", null, financeCookie))
        .data;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].department_id, finance);
      assert.equal(
        (await request("/conversations", "GET", null, salesCookie)).data.length,
        0,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}/messages`,
            "GET",
            null,
            salesCookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}`,
            "PATCH",
            { action: "claim" },
            salesCookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request("/reports", "GET", null, salesCookie)).data.total,
        0,
      );
      assert.equal(
        (await request("/reports", "GET", null, financeCookie)).data.total,
        1,
      );
    },
  );
  await t.test(
    "resposta exige assumir e usa payload oficial; nota interna não envia",
    async () => {
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}/messages`,
            "POST",
            { body: "Olá" },
            financeCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}`,
            "PATCH",
            { action: "claim" },
            financeCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}/messages`,
            "POST",
            { body: "Vamos ajudar" },
            financeCookie,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}/messages`,
            "POST",
            { body: "Conferir cadastro", note: true },
            financeCookie,
          )
        ).status,
        201,
      );
      const calls = [];
      const worker = makeWorker(db, env, async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return {
          ok: true,
          json: async () => ({ messages: [{ id: "out-" + calls.length }] }),
        };
      });
      await worker();
      assert.equal(calls.length, 3);
      assert.equal(calls.at(-1).body.text.body, "Vamos ajudar");
      assert.equal(calls.at(-1).body.to, "5579999999999");
      assert.match(calls[0].url, /graph.facebook.com\/v25.0\/12345\/messages/);
      assert.ok(
        db.prepare("SELECT first_response FROM conversations").get()
          .first_response,
      );
      assert.equal(
        db
          .prepare("SELECT COUNT(*) n FROM messages WHERE status='internal'")
          .get().n,
        1,
      );
      ingest(
        db,
        {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: "12345" },
                    statuses: [{ id: "out-3", status: "read" }],
                  },
                },
              ],
            },
          ],
        },
        env,
      );
      ingest(
        db,
        {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: "12345" },
                    statuses: [{ id: "out-3", status: "delivered" }],
                  },
                },
              ],
            },
          ],
        },
        env,
      );
      assert.equal(
        db.prepare("SELECT status FROM messages WHERE meta_id='out-3'").get()
          .status,
        "read",
      );
    },
  );
  await t.test(
    "janela de atendimento, transferência e encerramento",
    async () => {
      db.prepare("UPDATE conversations SET last_inbound=? WHERE id=?").run(
        Date.now() - 90000000,
        conversation.id,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}/messages`,
            "POST",
            { body: "Fora da janela" },
            financeCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/departments/${finance}`,
            "PATCH",
            { name: "Financeiro", active: false },
            adminCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}`,
            "PATCH",
            { action: "transfer", department_id: sales },
            financeCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}/messages`,
            "GET",
            null,
            financeCookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/conversations/${conversation.id}`,
            "PATCH",
            { action: "close" },
            salesCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("/reports", "GET", null, salesCookie)).data.closed,
        1,
      );
      assert.equal(
        (await request("/reports?start=bad", "GET", null, salesCookie)).status,
        400,
      );
    },
  );
  await t.test(
    "nova mensagem após encerramento inicia nova triagem",
    async () => {
      await sendWebhook(webhook("in-new", "Olá novamente"));
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM conversations").get().n,
        2,
      );
      assert.equal(
        db
          .prepare(
            "SELECT department_id FROM conversations WHERE status!='closed'",
          )
          .get().department_id,
        null,
      );
    },
  );
  await t.test(
    "desativação revoga acesso e protege último administrador",
    async () => {
      assert.equal(
        (
          await request(
            `/users/${financeUser}`,
            "PATCH",
            {
              name: "João Silva",
              role: "agent",
              department_id: finance,
              active: false,
            },
            adminCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("/me", "GET", null, financeCookie)).status,
        401,
      );
      assert.equal(
        (
          await request(
            `/users/${admin.user.id}`,
            "PATCH",
            {
              name: "Admin",
              role: "agent",
              department_id: finance,
              active: true,
            },
            adminCookie,
          )
        ).status,
        409,
      );
    },
  );
  await t.test("CSRF e arquivos privados não são expostos", async () => {
    const response = await fetch(base + "/api/departments", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        cookie: adminCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Ataque" }),
    });
    assert.equal(response.status, 403);
    for (const path of [
      "/.env",
      "/data/crm.sqlite",
      "/server/auth.js",
      "/node_modules/better-auth/package.json",
    ])
      assert.equal((await fetch(base + path)).status, 404);
    assert.equal(
      validSignature(Buffer.from("test"), "sha256=00", env.META_APP_SECRET),
      false,
    );
  });
});
