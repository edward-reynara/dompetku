import { describe, expect, it } from "vitest";
import {
  formatLinkCode,
  isChatVerified,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  linkCodeFrom,
  nextVerifiedAt,
  normalizeLinkCode,
  parseLinkCommand,
  planRecipients,
  type NotifyMember,
} from "@/lib/notify";
import { RESTORE_TABLES } from "@/lib/backup";
import { activityLabel } from "@/lib/activity";

const member = (over: Partial<NotifyMember> = {}): NotifyMember => ({
  user_id: "u1",
  username: "dini",
  display_name: null,
  role: "member",
  is_active: true,
  chat_id: "555",
  enabled: true,
  send_report: true,
  send_reminders: true,
  wallets: [],
  grants: { w1: "view" },
  ...over,
});

describe("/link codes (v28, #133)", () => {
  it("builds 8-char codes from the alphabet without modulo bias", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
    const code = linkCodeFrom(bytes);
    expect(code).toHaveLength(LINK_CODE_LENGTH);
    expect([...code].every((c) => LINK_CODE_ALPHABET.includes(c))).toBe(true);
    // Bytes ≥ 240 (256 - 256 % 30) are skipped, not folded onto the alphabet.
    const skipped = linkCodeFrom(Uint8Array.from([255, 250, 240, 0, 1, 2, 3, 4, 5, 6, 7]));
    expect(skipped).toBe(LINK_CODE_ALPHABET.slice(0, 8));
    expect(() => linkCodeFrom(Uint8Array.from([255, 255, 0]))).toThrow();
  });

  it("formats and normalises codes", () => {
    expect(formatLinkCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalizeLinkCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeLinkCode(" ab cd ef gh ")).toBe("ABCDEFGH");
    // 0/O/1/I/L/U are not in the alphabet; wrong length is refused.
    for (const bad of ["ABCDEFG0", "ABCDEFGI", "ABCDEFG", "ABCDEFGHJ", ""])
      expect(normalizeLinkCode(bad)).toBeNull();
  });

  it("parses /link with or without @bot and flags bad codes", () => {
    expect(parseLinkCommand("/link ABCD-EFGH")).toEqual({ code: "ABCDEFGH" });
    expect(parseLinkCommand("/link@dompetku_bot abcdefgh")).toEqual({ code: "ABCDEFGH" });
    expect(parseLinkCommand("  /LINK  abcd efgh ")).toEqual({ code: "ABCDEFGH" });
    expect(parseLinkCommand("/link")).toEqual({ code: null });
    expect(parseLinkCommand("/link nope")).toEqual({ code: null });
    for (const other of ["/linked ABCDEFGH", "link ABCDEFGH", "kopi 25rb", "", null, undefined])
      expect(parseLinkCommand(other)).toBeNull();
  });
});

describe("chat verification state (v28, #133)", () => {
  const now = "2026-11-20T00:00:00.000Z";
  const old = "2026-11-01T00:00:00.000Z";

  it("verifies a new/changed chat typed by the admin, not by the member", () => {
    expect(
      nextVerifiedAt({ prevChatId: null, prevVerifiedAt: null, nextChatId: "1", by: "admin", now }),
    ).toBe(now);
    expect(
      nextVerifiedAt({ prevChatId: "1", prevVerifiedAt: old, nextChatId: "2", by: "member", now }),
    ).toBeNull();
    expect(
      nextVerifiedAt({
        prevChatId: undefined,
        prevVerifiedAt: undefined,
        nextChatId: "2",
        by: "member",
        now,
      }),
    ).toBeNull();
  });

  it("keeps the state of an unchanged chat (toggles never verify it)", () => {
    expect(
      nextVerifiedAt({ prevChatId: "1", prevVerifiedAt: null, nextChatId: "1", by: "admin", now }),
    ).toBeNull();
    expect(
      nextVerifiedAt({ prevChatId: "1", prevVerifiedAt: old, nextChatId: "1", by: "member", now }),
    ).toBe(old);
  });

  it("treats a missing v28 column as verified", () => {
    expect(isChatVerified(undefined)).toBe(true);
    expect(isChatVerified(old)).toBe(true);
    expect(isChatVerified(null)).toBe(false);
  });

  it("skips unverified member chats in the recipient plan", () => {
    const plan = (m: NotifyMember) =>
      planRecipients({ adminChatId: "", kind: "report", members: [m] }).length;
    expect(plan(member({ verified: false }))).toBe(0);
    expect(plan(member({ verified: true }))).toBe(1);
    expect(plan(member())).toBe(1); // before v28: unchanged
  });

  it("never backs up link codes and labels the activity", () => {
    expect((RESTORE_TABLES as readonly string[]).includes("notify_link_codes")).toBe(false);
    expect(activityLabel("notify.link")).not.toBe("notify.link");
  });
});
