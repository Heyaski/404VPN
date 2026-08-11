import { describe, it, expect } from "vitest";
import { parsePrefix, formatPrefix, parseAsnList, aggregate } from "../src/bypass/prefixes.js";

describe("parseAsnList", () => {
  it("принимает номера с префиксом AS и без него", () => {
    expect(parseAsnList("AS12345, 200350")).toEqual([12345, 200350]);
  });

  it("не различает регистр и терпит лишние пробелы", () => {
    expect(parseAsnList(" as1 ,  As2 ")).toEqual([1, 2]);
  });

  it("выбрасывает мусор и повторы", () => {
    expect(parseAsnList("AS7, чепуха, 7, , -3")).toEqual([7]);
  });

  it("пустая строка даёт пустой список", () => {
    expect(parseAsnList("")).toEqual([]);
  });

  it("принимает список по одному номеру на строку", () => {
    expect(parseAsnList("AS44386\nAS207986\n\n  AS57073  ")).toEqual([44386, 207986, 57073]);
  });

  it("принимает смешанные разделители", () => {
    expect(parseAsnList("AS1; AS2\nAS3 AS4,AS5")).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("parsePrefix", () => {
  it("разбирает IPv4", () => {
    expect(parsePrefix("10.0.0.0/8")).toEqual({ bytes: [10, 0, 0, 0], length: 8 });
  });

  it("обнуляет биты за границей префикса", () => {
    expect(parsePrefix("10.1.2.3/8")).toEqual({ bytes: [10, 0, 0, 0], length: 8 });
  });

  it("разбирает IPv6 с сокращением", () => {
    const p = parsePrefix("2a02:6b8::/32");
    expect(p?.length).toBe(32);
    expect(p?.bytes.slice(0, 4)).toEqual([0x2a, 0x02, 0x06, 0xb8]);
    expect(p?.bytes).toHaveLength(16);
  });

  it("отвергает мусор", () => {
    expect(parsePrefix("не адрес")).toBeNull();
    expect(parsePrefix("10.0.0.0")).toBeNull();
    expect(parsePrefix("10.0.0.0/33")).toBeNull();
    expect(parsePrefix("999.0.0.0/8")).toBeNull();
  });

  it("формат — обратная операция к разбору", () => {
    expect(formatPrefix(parsePrefix("192.168.0.0/16")!)).toBe("192.168.0.0/16");
    expect(formatPrefix(parsePrefix("2a02:6b8::/32")!)).toBe("2a02:6b8::/32");
  });
});

describe("aggregate", () => {
  const p = (s: string) => parsePrefix(s)!;

  it("убирает вложенные диапазоны", () => {
    const result = aggregate([p("10.0.0.0/8"), p("10.1.0.0/16")]);
    expect(result.map(formatPrefix)).toEqual(["10.0.0.0/8"]);
  });

  it("убирает повторы", () => {
    const result = aggregate([p("10.0.0.0/8"), p("10.0.0.0/8")]);
    expect(result).toHaveLength(1);
  });

  it("оставляет непересекающиеся", () => {
    const result = aggregate([p("10.0.0.0/8"), p("192.168.0.0/16")]);
    expect(result).toHaveLength(2);
  });

  it("не смешивает версии протокола", () => {
    const result = aggregate([p("0.0.0.0/0"), p("2a02:6b8::/32")]);
    // IPv6 не вложен в IPv4-диапазон, несмотря на нулевую длину
    expect(result).toHaveLength(2);
  });

  it("пустой вход даёт пустой выход", () => {
    expect(aggregate([])).toEqual([]);
  });
});
