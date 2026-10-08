import { chromium } from "playwright";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.js";
import { createAuth } from "../server/auth.js";
import { createApp } from "../server/app.js";
import { ingest } from "../server/whatsapp.js";

const db = openDatabase(":memory:");
const env = {
  APP_URL: "http://localhost:3210",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  WHATSAPP_PHONE_NUMBER_ID: "test-number",
};
const auth = await createAuth(db, env);
const password = randomBytes(18).toString("hex");
const admin = await auth.api.createUser({
  body: {
    name: "Administrador",
    email: "admin@example.test",
    password,
    role: "admin",
  },
});
db.prepare("INSERT INTO staff(user_id,role) VALUES(?,'admin')").run(
  admin.user.id,
);
const server = createApp(db, auth, env).listen(3210, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || "chrome",
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("401"))
    errors.push(message.text());
});
mkdirSync("artifacts", { recursive: true });
try {
  await page.goto(env.APP_URL);
  await page
    .locator("#loginForm")
    .getByLabel("E-mail", { exact: true })
    .fill("admin@example.test");
  await page
    .locator("#loginForm")
    .getByLabel("Senha", { exact: true })
    .fill(password);
  await page.getByRole("button", { name: "Entrar no workspace" }).click();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Departamentos", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo departamento" }).click();
  await page.getByLabel("Nome do departamento").fill("Financeiro");
  await page.getByLabel("Descrição").fill("Contas, cobranças e pagamentos");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Financeiro", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Novo departamento" }).click();
  await page.getByLabel("Nome do departamento").fill("Comercial");
  await page.getByLabel("Descrição").fill("Propostas e novos negócios");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByRole("heading", { name: "Comercial", exact: true }).waitFor();
  await page.getByRole("button", { name: "Equipe", exact: true }).click();
  await page.getByRole("button", { name: "Cadastrar usuário" }).click();
  await page.getByLabel("Nome completo").fill("João Silva");
  await page.getByLabel("E-mail de acesso").fill("joao@example.test");
  await page.getByLabel("Senha inicial").fill(password);
  await page
    .getByLabel("Departamento", { exact: true })
    .selectOption({ label: "Financeiro" });
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("joao@example.test", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Contatos", exact: true }).click();
  await page.getByRole("button", { name: "Novo contato" }).click();
  await page.getByLabel("Nome completo").fill("Mariana Costa");
  await page.getByLabel("WhatsApp com país e DDD").fill("5579999999999");
  await page.getByLabel("Empresa", { exact: true }).fill("Costa & Co.");
  await page
    .getByLabel("Departamento", { exact: true })
    .selectOption({ label: "Financeiro" });
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("Mariana Costa", { exact: true }).waitFor();
  const inbound = (id, body) =>
    ingest(
      db,
      {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "test-number" },
                  messages: [
                    { id, from: "5579999999999", type: "text", text: { body } },
                  ],
                },
              },
            ],
          },
        ],
      },
      env,
    );
  inbound("browser-1", "Olá! Preciso da segunda via do boleto.");
  inbound("browser-2", "1");
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await page.getByRole("heading", { name: "Atendimentos recentes" }).waitFor();
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Atendimentos", exact: true }).click();
  await page.locator("[data-thread]").first().click();
  await page.getByRole("button", { name: "Assumir", exact: true }).click();
  await page.getByLabel("Nota interna").check();
  await page
    .getByRole("textbox", { name: "Mensagem", exact: true })
    .fill("Conferir o pagamento antes de responder.");
  await page.getByRole("button", { name: "Enviar", exact: false }).click();
  await page.locator(".message.note").waitFor();
  await page.screenshot({
    path: "artifacts/inbox-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Bot de atendimento", exact: true })
    .click();
  await page
    .getByLabel("Mensagem de boas-vindas")
    .fill("Olá! Como podemos ajudar hoje?");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  assert.equal(
    db.prepare("SELECT greeting FROM settings").get().greeting,
    "Olá! Como podemos ajudar hoje?",
  );
  await page.getByRole("button", { name: "Relatórios", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  assert.equal((await download).suggestedFilename(), "daegon-relatorio.csv");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of [
      "dashboard",
      "contacts",
      "departments",
      "users",
      "bot",
      "reports",
      "settings",
      "inbox",
    ]) {
      if (width <= 850)
        await page.getByRole("button", { name: "Abrir navegação" }).click();
      await page.locator(`[data-nav="${view}"]`).first().click();
      await page.locator(".page-head").waitFor();
      await page.evaluate(() =>
        Promise.all(
          document.getAnimations().map((animation) => animation.finished),
        ),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `Overflow in ${view} at ${width}`,
      );
      if (width === 390 && (view === "dashboard" || view === "inbox"))
        await page.screenshot({
          path: `artifacts/${view}-mobile.png`,
          fullPage: true,
        });
    }
  }
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await page
    .locator("#loginForm")
    .getByLabel("E-mail", { exact: true })
    .fill("joao@example.test");
  await page
    .locator("#loginForm")
    .getByLabel("Senha", { exact: true })
    .fill(password);
  await page.getByRole("button", { name: "Entrar no workspace" }).click();
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  assert.equal(await page.locator('[data-nav="users"]').count(), 0);
  assert.equal(await page.locator('[data-nav="settings"]').count(), 0);
  assert.equal(
    (await page.request.get(env.APP_URL + "/api/users")).status(),
    403,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: cadastros, login por departamento, bot, notas, CSV e 8 telas em 390/768/1440px.",
  );
} catch (error) {
  await page.screenshot({
    path: "artifacts/browser-failure.png",
    fullPage: true,
  });
  console.error("Browser errors:", errors);
  console.error("Page:", await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  server.close();
  db.close();
}
