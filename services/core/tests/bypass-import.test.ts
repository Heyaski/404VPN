import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type pg from "pg";
import { prepareTestDb, truncateAll } from "./helpers/testdb.js";
import { FakePrefixSource } from "../src/bypass/source.js";
import { importBypassPrefixes, listBypassPrefixes } from "../src/bypass/import.js";

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

async function setAsns(value: string) {
  await pool.query("UPDATE settings SET value=to_jsonb($1::text) WHERE key='bypass_asns'", [value]);
}

describe("importBypassPrefixes", () => {
  it("складывает префиксы всех номеров из настройки", async () => {
    await setAsns("AS1, AS2");
    const source = new FakePrefixSource({ 1: ["10.0.0.0/8"], 2: ["192.168.0.0/16"] });

    const stats = await importBypassPrefixes(pool, source);

    expect(stats).toEqual({ asns: 2, prefixes: 2 });
    expect((await listBypassPrefixes(pool)).sort())
      .toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });

  it("пустая настройка очищает таблицу", async () => {
    await setAsns("AS1");
    await importBypassPrefixes(pool, new FakePrefixSource({ 1: ["10.0.0.0/8"] }));

    await setAsns("");
    const stats = await importBypassPrefixes(pool, new FakePrefixSource({}));

    expect(stats).toEqual({ asns: 0, prefixes: 0 });
    expect(await listBypassPrefixes(pool)).toEqual([]);
  });

  it("ошибка источника не трогает уже импортированное", async () => {
    await setAsns("AS1");
    await importBypassPrefixes(pool, new FakePrefixSource({ 1: ["10.0.0.0/8"] }));

    await setAsns("AS1, AS2");
    const failing = new FakePrefixSource({ 1: ["10.0.0.0/8"] }, { failOn: [2] });
    await expect(importBypassPrefixes(pool, failing)).rejects.toThrow();

    // одна неудачная ночь не должна оставлять пользователей без обхода
    expect(await listBypassPrefixes(pool)).toEqual(["10.0.0.0/8"]);
  });

  it("выбрасывает неразобранные префиксы, остальные сохраняет", async () => {
    await setAsns("AS1");
    const source = new FakePrefixSource({ 1: ["10.0.0.0/8", "чепуха", "10.0.0.0/99"] });

    await importBypassPrefixes(pool, source);

    expect(await listBypassPrefixes(pool)).toEqual(["10.0.0.0/8"]);
  });

  it("схлопывает вложенные диапазоны разных номеров", async () => {
    await setAsns("AS1, AS2");
    const source = new FakePrefixSource({ 1: ["10.0.0.0/8"], 2: ["10.1.0.0/16"] });

    await importBypassPrefixes(pool, source);

    expect(await listBypassPrefixes(pool)).toEqual(["10.0.0.0/8"]);
  });

  it("пустой список при нетронутой таблице", async () => {
    expect(await listBypassPrefixes(pool)).toEqual([]);
  });
});
