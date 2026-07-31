import { useEffect, useState } from "react";
import { api, type Support as SupportData } from "../api";
import { tg } from "../telegram";

export function Support() {
  const [data, setData] = useState<SupportData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<SupportData>("/support").then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;

  return (
    <div className="card">
      <button className="disclosure" onClick={() => setOpen(!open)}>
        <span>Как это работает и поддержка</span>
        <span className="mono">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <>
          <p style={{ whiteSpace: "pre-line", margin: "12px 0 0", fontSize: 14 }}>{data.help}</p>
          {data.contact && (
            <button
              className="chip"
              style={{ width: "100%", marginTop: 12 }}
              onClick={() => {
                const handle = data.contact.replace(/^@/, "");
                tg()?.openLink(`https://t.me/${handle}`);
              }}
            >
              Написать в поддержку {data.contact}
            </button>
          )}
        </>
      )}
    </div>
  );
}
