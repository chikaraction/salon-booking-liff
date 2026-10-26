import { describe, expect, it } from "vitest";
import { HSTS_HEADER_VALUE, httpsRedirectUrl } from "./https";

describe("httpsRedirectUrl: http アクセスの https への転送先", () => {
  it("http のURLは同じホスト・パス・クエリの https URL にする", () => {
    expect(
      httpsRedirectUrl("http://salon.example.workers.dev/booking?menu=a&x=1"),
    ).toBe("https://salon.example.workers.dev/booking?menu=a&x=1");
  });

  it("パスもクエリも無い http のURLはルートの https URL にする", () => {
    expect(httpsRedirectUrl("http://salon.example.workers.dev")).toBe(
      "https://salon.example.workers.dev/",
    );
  });

  it("スキームの大文字小文字は問わない(URLとして解釈して判定する)", () => {
    expect(httpsRedirectUrl("HTTP://salon.example.workers.dev/admin")).toBe(
      "https://salon.example.workers.dev/admin",
    );
  });

  it("https のURLは転送しない", () => {
    expect(
      httpsRedirectUrl("https://salon.example.workers.dev/booking"),
    ).toBeNull();
  });

  it("ローカル実行(localhost・127.0.0.1・[::1])は http でも転送しない", () => {
    expect(httpsRedirectUrl("http://localhost:3000/admin")).toBeNull();
    expect(httpsRedirectUrl("http://127.0.0.1:8787/")).toBeNull();
    expect(httpsRedirectUrl("http://[::1]:3000/booking")).toBeNull();
  });

  it("ホスト名が localhost で始まるだけの別ホストは転送する(前方一致で判定しない)", () => {
    expect(httpsRedirectUrl("http://localhost.example.com/")).toBe(
      "https://localhost.example.com/",
    );
    expect(httpsRedirectUrl("http://127.0.0.1.example.com/")).toBe(
      "https://127.0.0.1.example.com/",
    );
  });

  it("URLとして解釈できない文字列は転送しない", () => {
    expect(httpsRedirectUrl("")).toBeNull();
    expect(httpsRedirectUrl("not a url")).toBeNull();
  });
});

describe("HSTS_HEADER_VALUE: Strict-Transport-Security の値", () => {
  it("1年間 https を強制し、includeSubDomains と preload は付けない", () => {
    expect(HSTS_HEADER_VALUE).toBe("max-age=31536000");
  });
});
