import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  BOT_TOKEN: z.string().min(10),
  ROBOKASSA_LOGIN: z.string().min(1),
  ROBOKASSA_PASSWORD1: z.string().min(1),
  ROBOKASSA_PASSWORD2: z.string().min(1),
  ROBOKASSA_TEST: z
    .string()
    .default("1")
    .transform((v) => v !== "0" && v.toLowerCase() !== "false"),
  PORT: z.coerce.number().default(8080),
  // URL Mini App (https://<домен>/) — задаётся в проде, локально можно не указывать
  MINIAPP_URL: z.string().url().optional(),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return Env.parse(env);
}
