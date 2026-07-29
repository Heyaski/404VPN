import { describe, it, expect } from "vitest";
import { parseWgConf } from "../src/wg/provider.js";

const CONF = `[Interface]
PrivateKey = aPrivateKeyValue=
Address = 10.8.0.5/24
DNS = 1.1.1.1, 8.8.8.8
MTU = 1420

[Peer]
PublicKey = serverPublicKey=
PresharedKey = sharedSecret=
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
Endpoint = 195.14.118.198:51820`;

describe("parseWgConf", () => {
  it("extracts interface and peer fields", () => {
    const t = parseWgConf(CONF);
    expect(t.privateKey).toBe("aPrivateKeyValue=");
    expect(t.address).toBe("10.8.0.5/24");
    expect(t.dns).toEqual(["1.1.1.1", "8.8.8.8"]);
    expect(t.peer.publicKey).toBe("serverPublicKey=");
    expect(t.peer.presharedKey).toBe("sharedSecret=");
    expect(t.peer.allowedIps).toEqual(["0.0.0.0/0", "::/0"]);
    expect(t.peer.persistentKeepalive).toBe(25);
    expect(t.peer.endpoint).toBe("195.14.118.198:51820");
  });
  it("overrides the endpoint host but keeps the port", () => {
    expect(parseWgConf(CONF, "vpn.404studiotech-miniapp.ru").peer.endpoint)
      .toBe("vpn.404studiotech-miniapp.ru:51820");
  });
  it("omits presharedKey when absent", () => {
    const t = parseWgConf("[Interface]\nPrivateKey = k\n\n[Peer]\nPublicKey = p\nEndpoint = h:51820");
    expect(t.peer.presharedKey).toBeUndefined();
    expect(t.dns).toEqual([]);
  });
  it("ignores comments and blank lines", () => {
    const t = parseWgConf("# комментарий\n[Interface]\n\nAddress = 10.0.0.2/32\n");
    expect(t.address).toBe("10.0.0.2/32");
  });
});
