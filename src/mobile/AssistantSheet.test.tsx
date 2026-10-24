// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";

let chatPanelRenders = 0;
vi.mock("@/components/chat/ChatPanel", () => ({
  ChatPanel: () => {
    chatPanelRenders += 1;
    return <div data-testid="chat-panel" />;
  },
}));

import { AssistantSheet } from "./AssistantSheet";

afterEach(() => {
  cleanup();
  chatPanelRenders = 0;
});

function renderSheet(onSnapChange = vi.fn()) {
  const view = render(
    <div style={{ height: 800 }}>
      <AssistantSheet snap="half" onSnapChange={onSnapChange} bookId="book-1" onOpenQuote={() => {}} />
    </div>,
  );
  const sheet = view.container.querySelector("section")!;
  vi.spyOn(sheet.parentElement!, "getBoundingClientRect").mockReturnValue({ height: 800 } as DOMRect);
  return { sheet, handle: screen.getByRole("separator", { name: t("mobile.sheetHandle") }) };
}

describe("AssistantSheet drag", () => {
  it("follows the pointer without re-rendering the conversation", () => {
    const { sheet, handle } = renderSheet();
    const before = chatPanelRenders;

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
    for (const clientY of [380, 340, 300, 260]) {
      fireEvent.pointerMove(handle, { pointerId: 1, clientY });
    }

    expect(chatPanelRenders).toBe(before);
    expect(sheet.style.height).toBe("calc(50% + 140px)");
    expect(sheet.dataset.dragging).toBe("");
  });

  it("settles back to its snap height when the drag doesn't reach another snap", () => {
    const onSnapChange = vi.fn();
    const { sheet, handle } = renderSheet(onSnapChange);

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 380 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 380 });

    expect(onSnapChange).not.toHaveBeenCalled();
    expect(sheet.style.height).toBe("calc(50% - 0px)");
    expect(sheet.dataset.dragging).toBeUndefined();
  });

  it("hands a long drag to the nearest snap", () => {
    const onSnapChange = vi.fn();
    const { handle } = renderSheet(onSnapChange);

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 0 });

    expect(onSnapChange).toHaveBeenCalledWith("full");
  });
});
