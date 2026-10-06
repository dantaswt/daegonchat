import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function openDatabase(path = process.env.DB_PATH || "data/crm.sqlite") {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS staff (
      user_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','agent')),
      department_id INTEGER REFERENCES departments(id), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', department_id INTEGER REFERENCES departments(id),
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contacts(id), department_id INTEGER REFERENCES departments(id),
      assignee TEXT REFERENCES staff(user_id), status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','active','closed')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER, last_inbound INTEGER,
      first_response INTEGER, menu TEXT NOT NULL DEFAULT '[]');
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_conversation ON conversations(contact_id) WHERE status != 'closed';
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id),
      direction TEXT NOT NULL CHECK(direction IN ('in','out','bot','note')), body TEXT NOT NULL, sender TEXT,
      meta_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'received', created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation_id,id);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), bot_enabled INTEGER NOT NULL DEFAULT 1,
      greeting TEXT NOT NULL DEFAULT 'Olá! Bem-vindo à Daegon. Com qual departamento você deseja falar?');
    INSERT OR IGNORE INTO settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  return db;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export const audit = (db, actor, action) =>
  db
    .prepare("INSERT INTO audit(actor,action,created_at) VALUES(?,?,?)")
    .run(actor, action, Date.now());
