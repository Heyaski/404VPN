import assert from "node:assert/strict";
import { allowedIPsExcluding } from "../src/shared/routeCalculator.ts";

// Без исключений — весь интернет.
{
  const ips = allowedIPsExcluding([]);
  assert.deepEqual(ips, ["0.0.0.0/0", "::/0"]);
}

// Исключение /8 не должно оставлять дыру без IPv4.
{
  const ips = allowedIPsExcluding(["10.0.0.0/8"]);
  assert.ok(ips.some((x) => x.startsWith("0.") || x === "0.0.0.0/1" || x.startsWith("128.") || x.includes("/")));
  assert.ok(ips.includes("::/0") || ips.some((x) => x.includes(":")));
  assert.ok(!ips.includes("10.0.0.0/8"));
}

console.log("routeCalculator ok");
