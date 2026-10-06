import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { getMigrations } from "better-auth/db/migration";

export async function createAuth(db, env = process.env) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error(
      "Configure BETTER_AUTH_SECRET com pelo menos 32 caracteres.",
    );
  const options = {
    database: db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL || "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    advanced: { ipAddress: { ipAddressHeaders: ["x-daegon-client-ip"] } },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    plugins: [admin()],
  };
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  return betterAuth(options);
}
