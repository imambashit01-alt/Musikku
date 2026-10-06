import dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({ path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))) });

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default("0.0.0.0"),
  DATABASE_PATH: z.string().min(1).default("./data/musikku.sqlite"),
  DATA_DIRECTORY: z.string().min(1).default("./data"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET harus minimal 32 karakter"),
  JWT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(7 * 24 * 60 * 60),
  OWNER_USERNAME: z.string().trim().min(1).default("owner"),
  OWNER_PASSWORD: z.string().min(12, "OWNER_PASSWORD harus minimal 12 karakter"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  DESKTOP_AUTH_TOKEN: z.string().length(64).optional(),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  databasePath: string;
  dataDirectory: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  ownerUsername: string;
  ownerPassword: string;
  clientOrigin: string;
  desktopAuthToken?: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Konfigurasi tidak valid: ${parsed.error.message}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    databasePath: parsed.data.DATABASE_PATH,
    dataDirectory: parsed.data.DATA_DIRECTORY,
    jwtSecret: parsed.data.JWT_SECRET,
    jwtTtlSeconds: parsed.data.JWT_TTL_SECONDS,
    ownerUsername: parsed.data.OWNER_USERNAME,
    ownerPassword: parsed.data.OWNER_PASSWORD,
    clientOrigin: parsed.data.CLIENT_ORIGIN,
    ...(parsed.data.DESKTOP_AUTH_TOKEN ? { desktopAuthToken: parsed.data.DESKTOP_AUTH_TOKEN } : {}),
  };
}
