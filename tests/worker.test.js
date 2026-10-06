import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.js";
import { enqueue, makeWorker, ingest } from "../server/whatsapp.js";

test("Fila Meta preserva mensagens e trata falhas sem envios silenciosos", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const env = {
    WHATSAPP_ACCESS_TOKEN: "fake",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_VERIFY_TOKEN: "verify",
    META_APP_SECRET: "secret",
    META_GRAPH_VERSION: "v25.0",
  };
  db.prepare("INSERT INTO contacts(name,phone,created_at) VALUES(?,?,?)").run(
    "Teste",
    "5579999999999",
    Date.now(),
  );
  db.prepare(
    "INSERT INTO conversations(contact_id,created_at,updated_at,last_inbound) VALUES(1,?,?,?)",
  ).run(Date.now(), Date.now(), Date.now());
  const message = enqueue(db, 1, "Teste de envio", "out", "test");
  let attempts = 0;
  await makeWorker(db, {}, async () => {
    attempts++;
  })();
  assert.equal(attempts, 0);
  const worker = makeWorker(db, env, async () => {
    attempts++;
    return {
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 4, message: "Rate limit" } }),
    };
  });
  await worker();
  assert.equal(attempts, 1);
  assert.equal(
    db.prepare("SELECT status FROM messages WHERE id=?").get(message).status,
    "pending",
  );
  await worker();
  assert.equal(attempts, 1, "Respeita espera entre tentativas");
  for (let i = 0; i < 4; i++) {
    db.prepare("UPDATE messages SET next_attempt=0 WHERE id=?").run(message);
    await worker();
  }
  assert.equal(
    db.prepare("SELECT status FROM messages WHERE id=?").get(message).status,
    "failed",
  );
  assert.equal(attempts, 5);
  const uncertain = enqueue(db, 1, "Resposta incerta", "out", "test");
  await makeWorker(db, env, async () => {
    throw new Error("Network timeout");
  })();
  assert.equal(
    db.prepare("SELECT status FROM messages WHERE id=?").get(uncertain).status,
    "failed",
  );
  assert.equal(
    db.prepare("SELECT attempts FROM messages WHERE id=?").get(uncertain)
      .attempts,
    1,
  );
  const expired = enqueue(db, 1, "Resposta atrasada", "out", "test");
  db.prepare("UPDATE conversations SET last_inbound=?").run(
    Date.now() - 90000000,
  );
  await worker();
  assert.equal(attempts, 5);
  assert.equal(
    db.prepare("SELECT status FROM messages WHERE id=?").get(expired).status,
    "failed",
  );
});

test("Menus longos são divididos dentro do limite de texto da Meta", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  for (let i = 0; i < 75; i++)
    db.prepare("INSERT INTO departments(name) VALUES(?)").run(
      `Departamento ${i} ` + "x".repeat(60),
    );
  ingest(
    db,
    {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123" },
                messages: [
                  {
                    id: "menu-long",
                    from: "5579999999999",
                    text: { body: "Olá" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    { WHATSAPP_PHONE_NUMBER_ID: "123" },
  );
  const messages = db
    .prepare("SELECT body FROM messages WHERE direction='bot' ORDER BY id")
    .all();
  assert.ok(messages.length > 1);
  assert.ok(messages.every((m) => m.body.length <= 4000));
  assert.match(messages.map((m) => m.body).join("\n"), /75 — Departamento 74/);
});
