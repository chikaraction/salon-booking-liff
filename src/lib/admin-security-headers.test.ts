import { describe, expect, it } from "vitest";
import { ADMIN_SECURITY_HEADERS } from "./admin-security-headers";

describe("ADMIN_SECURITY_HEADERS: 管理画面の応答に付けるヘッダー", () => {
  it("他サイトの iframe への埋め込みを X-Frame-Options と CSP の両方で禁止する", () => {
    expect(ADMIN_SECURITY_HEADERS).toEqual({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
  });
});
