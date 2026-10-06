import { openDatabase } from "./db.js";
import { createAuth } from "./auth.js";
const db = openDatabase();
const auth = await createAuth(db);
if (db.prepare("SELECT user_id FROM staff WHERE role='admin'").get())
  throw new Error(
    "Administrador já cadastrado. Use a tela Equipe para gerenciar contas.",
  );
const {
  ADMIN_EMAIL: email,
  ADMIN_PASSWORD: password,
  ADMIN_NAME: name = "Administrador",
} = process.env;
if (!email || !password || password.length < 12)
  throw new Error(
    "Configure ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 12 caracteres) no .env antes de executar setup.",
  );
const result = await auth.api.createUser({
  body: { email, password, name, role: "admin" },
});
db.prepare("INSERT INTO staff(user_id,role) VALUES(?,'admin')").run(
  result.user.id,
);
console.log(
  "Administrador criado. Entre no CRM com o e-mail e a senha configurados. Remova ADMIN_PASSWORD do .env após o cadastro.",
);
db.close();
