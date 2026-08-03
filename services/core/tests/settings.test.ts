import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { getTextSetting, parseDnsList } from "../src/settings.js";

let pool: pg.Pool;

beforeAll(async () => {
  pool = await prepareTestDb();
});

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("parseDnsList", () => {
  it("разбирает адреса через запятую", () => {
    expect(parseDnsList("1.1.1.1, 1.0.0.1")).toEqual(["1.1.1.1", "1.0.0.1"]);
  });

  it("пустая строка даёт пустой список", () => {
    expect(parseDnsList("")).toEqual([]);
    expect(parseDnsList("   ")).toEqual([]);
  });

  it("выбрасывает пустые элементы и лишние пробелы", () => {
    expect(parseDnsList(" 10.8.0.53 ,, ")).toEqual(["10.8.0.53"]);
  });

  it("одиночный адрес без запятых", () => {
    expect(parseDnsList("172.18.0.53")).toEqual(["172.18.0.53"]);
  });
});

describe("getTextSetting", () => {
  it("возвращает текст настройки", async () => {
    await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='support_contact'", ["@help"]);

    expect(await getTextSetting(pool, "support_contact")).toBe("@help");
  });

  it("несуществующий ключ даёт пустую строку", async () => {
    expect(await getTextSetting(pool, "нет_такого_ключа")).toBe("");
  });
});
