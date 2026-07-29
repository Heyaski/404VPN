import express from "express";
import type { RobokassaCreds } from "./robokassa.js";
import { verifyResultSignature } from "./robokassa.js";
import { withTx } from "./db.js";
import { processSuccessfulPayment } from "./payments.js";

export function createWebhookApp(creds: RobokassaCreds): express.Express {
  const app = express();
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
    const result = await withTx((c) => processSuccessfulPayment(c, Number(InvId), OutSum));
    if (result.kind === "rejected") {
      res.status(400).send(result.reason);
      return;
    }
    res.send(`OK${InvId}`); // строгий формат ответа Robokassa
  });
  return app;
}
