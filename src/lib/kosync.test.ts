import { describe, expect, it } from "vitest";
import { shouldOfferJump, type KosyncPull } from "./kosync";

function pull(timestamp: number, percentage: number, localPositionUpdatedAt?: string | null): KosyncPull {
  return {
    remote: { progress: "/body/DocFragment[2]/body/p", percentage, device: "Kobo", deviceId: "k", timestamp },
    localPositionUpdatedAt,
  };
}

const LOCAL = "2026-10-17T10:00:00.000Z";
const LOCAL_S = Date.parse(LOCAL) / 1000;

describe("shouldOfferJump", () => {
  it("offers a newer position elsewhere in the book", () => {
    expect(shouldOfferJump(pull(LOCAL_S + 60, 0.42, LOCAL), 0.17)).toBe(true);
  });

  it("ignores a remote position older than or as old as the local one", () => {
    expect(shouldOfferJump(pull(LOCAL_S - 60, 0.42, LOCAL), 0.17)).toBe(false);
    expect(shouldOfferJump(pull(LOCAL_S, 0.42, LOCAL), 0.17)).toBe(false);
  });

  it("ignores a newer position at the same place", () => {
    expect(shouldOfferJump(pull(LOCAL_S + 60, 0.4205, LOCAL), 0.42)).toBe(false);
  });

  it("offers any remote position when this device never moved", () => {
    expect(shouldOfferJump(pull(1, 0.3, null), undefined)).toBe(true);
    expect(shouldOfferJump(pull(1, 0, null), undefined)).toBe(false);
  });
});
