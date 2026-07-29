export function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export function daysLeft(balanceRub: number, devices: number, monthlyPrice: number): number {
  if (devices <= 0) return Infinity;
  const dailyKop = Math.round((monthlyPrice * 100) / 30) * devices;
  return Math.floor(Math.round(balanceRub * 100) / dailyKop);
}
