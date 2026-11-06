// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChoiceChips } from "@/mobile/ChoiceChips";

const OPTIONS = [
  { value: "unread", label: "Unread", dotClass: "bg-muted-foreground" },
  { value: "reading", label: "Reading", dotClass: "bg-primary" },
] as const;

afterEach(cleanup);

describe("ChoiceChips", () => {
  it("names the group and checks the picked chip", () => {
    const { getByRole } = render(
      <ChoiceChips value="reading" options={OPTIONS} onChange={vi.fn()} ariaLabel="Reading status" />,
    );
    expect(getByRole("radiogroup", { name: "Reading status" })).toBeTruthy();
    expect(getByRole("radio", { name: "Reading" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("radio", { name: "Unread" }).getAttribute("aria-checked")).toBe("false");
  });

  it("reports the tapped chip", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <ChoiceChips value="reading" options={OPTIONS} onChange={onChange} ariaLabel="Reading status" />,
    );
    fireEvent.click(getByRole("radio", { name: "Unread" }));
    expect(onChange).toHaveBeenCalledWith("unread");
  });

  it("shows a status dot only on chips that are not picked", () => {
    const { getByRole } = render(
      <ChoiceChips value="reading" options={OPTIONS} onChange={vi.fn()} ariaLabel="Reading status" />,
    );
    expect(getByRole("radio", { name: "Unread" }).querySelector(".bg-muted-foreground")).not.toBeNull();
    expect(getByRole("radio", { name: "Reading" }).querySelector(".bg-primary")).toBeNull();
  });
});
