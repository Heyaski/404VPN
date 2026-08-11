/** Откуда берутся префиксы автономной системы. Реализаций две: RIPEstat и подставная. */
export interface PrefixSource {
  prefixesFor(asn: number): Promise<string[]>;
}

/** Источник для тестов: отдаёт заранее заданное, умеет падать на указанных номерах. */
export class FakePrefixSource implements PrefixSource {
  asked: number[] = [];

  constructor(
    private readonly data: Record<number, string[]>,
    private readonly opts: { failOn?: number[] } = {},
  ) {}

  async prefixesFor(asn: number): Promise<string[]> {
    this.asked.push(asn);
    if (this.opts.failOn?.includes(asn)) throw new Error(`источник упал на AS${asn}`);
    return this.data[asn] ?? [];
  }
}
