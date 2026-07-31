import express from "express";
import type pg from "pg";
import type { RobokassaCreds } from "./robokassa.js";
import { verifyResultSignature } from "./robokassa.js";
import { pool as defaultPool, withTxOn } from "./db.js";
import { processSuccessfulPayment } from "./payments.js";
import { reactivate } from "./billing.js";
import type { WgProvider } from "./wg/provider.js";

export function createWebhookApp(
  creds: RobokassaCreds,
  wg: WgProvider,
  db: pg.Pool = defaultPool,
): express.Express {
  const app = express();
  app.set("trust proxy", true); // за Caddy — иначе req.ip будет адресом прокси
  app.use(express.urlencoded({ extended: false }));

  app.post("/payhook/robokassa/result", async (req, res) => {
    const { OutSum, InvId, SignatureValue } = req.body as Record<string, string>;
    if (!OutSum || !InvId || !SignatureValue) {
      res.status(400).send("bad request");
      return;
    }
    if (!verifyResultSignature(creds, { OutSum, InvId, SignatureValue })) {
      res.status(400).send("bad sign");
      return;
    }
    const result = await withTxOn(db, (c) => processSuccessfulPayment(c, Number(InvId), OutSum));
    if (result.kind === "rejected") {
      res.status(400).send(result.reason);
      return;
    }
    if (result.kind === "credited") {
      // деньги уже зачислены — сбой снятия приостановки не должен приводить к ретраю
      // платежа: подстраховкой служит периодический syncAllAccess
      try {
        await reactivate(db, wg, result.userId);
      } catch (e) {
        console.error("reactivate after payment failed:", e);
      }
    }
    res.send(`OK${InvId}`); // строгий формат ответа Robokassa
  });

  return app;
}
