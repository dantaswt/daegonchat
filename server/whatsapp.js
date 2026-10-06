import { createHmac, timingSafeEqual } from "node:crypto";
import { transaction } from "./db.js";

export const requiredMeta = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "META_APP_SECRET",
  "META_GRAPH_VERSION",
];
export const configuration = (env) => ({
  configured: requiredMeta.every((key) => Boolean(env[key])),
  missing: requiredMeta.filter((key) => !env[key]),
  phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || "",
});
export function validSignature(raw, signature, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature || "")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function enqueue(
  db,
  conversationId,
  body,
  direction = "bot",
  sender = null,
) {
  if (direction === "bot" && body.length > 4000) {
    let buffer = "",
      lastId;
    for (const line of body.split("\n")) {
      if (buffer.length + line.length + 1 > 4000) {
        lastId = enqueue(db, conversationId, buffer, direction, sender);
        buffer = "";
      }
      buffer += (buffer ? "\n" : "") + line;
    }
    if (buffer) lastId = enqueue(db, conversationId, buffer, direction, sender);
    return lastId;
  }
  return Number(
    db
      .prepare(
        `INSERT INTO messages(conversation_id,direction,body,sender,status,created_at) VALUES(?,?,?,?, 'pending',?)`,
      )
      .run(conversationId, direction, body, sender, Date.now()).lastInsertRowid,
  );
}
function menu(db, conversationId) {
  const departments = db
    .prepare("SELECT id,name FROM departments WHERE active=1 ORDER BY id")
    .all();
  db.prepare("UPDATE conversations SET menu=? WHERE id=?").run(
    JSON.stringify(departments.map((d) => d.id)),
    conversationId,
  );
  const { greeting } = db
    .prepare("SELECT greeting FROM settings WHERE id=1")
    .get();
  return departments.length
    ? `${greeting}\n\n${departments.map((d, i) => `${i + 1} — ${d.name}`).join("\n")}\n\nResponda com o número do departamento.`
    : "Olá! Nossa equipe recebeu sua mensagem. Aguarde o atendimento.";
}
export function ingest(db, payload, env) {
  transaction(db, () => {
    for (const entry of payload.entry || [])
      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (value.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID)
          continue;
        for (const status of value.statuses || []) {
          const current = db
            .prepare("SELECT id,status FROM messages WHERE meta_id=?")
            .get(status.id);
          const rank = { pending: 0, sent: 1, delivered: 2, read: 3 };
          if (
            current &&
            (status.status === "failed" ||
              (rank[status.status] ?? -1) > (rank[current.status] ?? -1))
          ) {
            db.prepare("UPDATE messages SET status=?,error=? WHERE id=?").run(
              status.status,
              status.errors?.[0]?.title || null,
              current.id,
            );
          }
        }
        for (const message of value.messages || []) {
          if (
            !message.id ||
            !/^\d{8,15}$/.test(message.from || "") ||
            db
              .prepare("SELECT id FROM messages WHERE meta_id=?")
              .get(message.id)
          )
            continue;
          const now = Date.now();
          const inboundTime = Math.min(
            now,
            (Number(message.timestamp) || Math.floor(now / 1000)) * 1000,
          );
          const name =
            value.contacts?.find((c) => c.wa_id === message.from)?.profile
              ?.name || message.from;
          db.prepare(
            "INSERT OR IGNORE INTO contacts(name,phone,created_at) VALUES(?,?,?)",
          ).run(name, message.from, now);
          const contact = db
            .prepare("SELECT * FROM contacts WHERE phone=?")
            .get(message.from);
          let conversation = db
            .prepare(
              "SELECT * FROM conversations WHERE contact_id=? AND status!='closed'",
            )
            .get(contact.id);
          let fresh = false;
          if (!conversation) {
            const id = Number(
              db
                .prepare(
                  "INSERT INTO conversations(contact_id,created_at,updated_at,last_inbound) VALUES(?,?,?,?)",
                )
                .run(contact.id, now, now, inboundTime).lastInsertRowid,
            );
            conversation = db
              .prepare("SELECT * FROM conversations WHERE id=?")
              .get(id);
            fresh = true;
          }
          const text =
            message.text?.body ||
            message.interactive?.list_reply?.title ||
            message.interactive?.button_reply?.title ||
            `[${message.type || "mensagem"} recebido — conteúdo de mídia não disponível nesta versão]`;
          db.prepare(
            "INSERT INTO messages(conversation_id,direction,body,meta_id,created_at) VALUES(?,?,?,?,?)",
          ).run(conversation.id, "in", text, message.id, inboundTime);
          db.prepare(
            "UPDATE conversations SET updated_at=?,last_inbound=MAX(COALESCE(last_inbound,0),?) WHERE id=?",
          ).run(now, inboundTime, conversation.id);
          const bot = db
            .prepare("SELECT bot_enabled FROM settings WHERE id=1")
            .get().bot_enabled;
          if (!bot || conversation.department_id || conversation.assignee)
            continue;
          const choices = JSON.parse(conversation.menu);
          const selection = /^\d+$/.test(text.trim())
            ? choices[Number(text.trim()) - 1]
            : null;
          const dept =
            selection &&
            db
              .prepare("SELECT * FROM departments WHERE id=? AND active=1")
              .get(selection);
          if (dept) {
            db.prepare(
              "UPDATE conversations SET department_id=?,menu='[]' WHERE id=?",
            ).run(dept.id, conversation.id);
            db.prepare("UPDATE contacts SET department_id=? WHERE id=?").run(
              dept.id,
              contact.id,
            );
            enqueue(
              db,
              conversation.id,
              `Você foi direcionado para ${dept.name}. Um atendente da equipe responderá por aqui. Obrigado por aguardar!`,
            );
          } else {
            enqueue(
              db,
              conversation.id,
              `${fresh ? "" : "Escolha uma das opções abaixo.\n\n"}${menu(db, conversation.id)}`,
            );
          }
        }
      }
  });
}
export function makeWorker(db, env, fetcher = fetch) {
  let busy = false;
  return async () => {
    if (busy || !configuration(env).configured) return;
    busy = true;
    try {
      const messages = db
        .prepare(
          `SELECT m.*,c.last_inbound,p.phone FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN contacts p ON p.id=c.contact_id WHERE m.status='pending' AND m.next_attempt<=? ORDER BY m.id LIMIT 10`,
        )
        .all(Date.now());
      for (const message of messages) {
        if (
          !message.last_inbound ||
          Date.now() - message.last_inbound >= 86400000
        ) {
          db.prepare(
            "UPDATE messages SET status='failed',error=? WHERE id=?",
          ).run(
            "Janela de 24 horas encerrada. Aguarde nova mensagem do cliente.",
            message.id,
          );
          continue;
        }
        try {
          const response = await fetcher(
            `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: message.phone,
                type: "text",
                text: { body: message.body },
              }),
              signal: AbortSignal.timeout(15000),
            },
          );
          const result = await response.json();
          if (!response.ok || !result.messages?.[0]?.id) {
            const error = new Error(
              `Meta: ${result.error?.code || response.status}. ${result.error?.message || "Envio não confirmado."}`,
            );
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
          }
          db.prepare(
            "UPDATE messages SET status='sent',meta_id=?,attempts=attempts+1,error=NULL WHERE id=?",
          ).run(result.messages[0].id, message.id);
          if (message.direction === "out")
            db.prepare(
              "UPDATE conversations SET first_response=COALESCE(first_response,?) WHERE id=?",
            ).run(Date.now(), message.conversation_id);
        } catch (error) {
          const attempts = message.attempts + 1;
          // Unknown network outcome is not retried automatically: Meta may have accepted the message.
          db.prepare(
            "UPDATE messages SET status=?,attempts=?,next_attempt=?,error=? WHERE id=?",
          ).run(
            error.retryable && attempts < 5 ? "pending" : "failed",
            attempts,
            Date.now() + 30000 * 2 ** attempts,
            error.message.slice(0, 500),
            message.id,
          );
        }
      }
    } finally {
      busy = false;
    }
  };
}
