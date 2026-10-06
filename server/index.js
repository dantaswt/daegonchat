import { openDatabase } from "./db.js";
import { createAuth } from "./auth.js";
import { createApp } from "./app.js";
import { makeWorker } from "./whatsapp.js";
const db = openDatabase();
const auth = await createAuth(db);
const app = createApp(db, auth);
const worker = makeWorker(db, process.env);
const timer = setInterval(
  () =>
    worker().catch((error) => console.error("WhatsApp worker:", error.message)),
  2000,
);
const server = app.listen(
  Number(process.env.PORT) || 3000,
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `Daegon CRM disponível em ${process.env.APP_URL || "http://localhost:3000"}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
