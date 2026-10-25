// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";
import type { SheetSnap } from "@/lib/assistant-sheet";
import type { ChatActivity } from "@/lib/chat-activity";

let chatPanelRenders = 0;
let reportActivity: ((activity: ChatActivity) => void) | undefined;
vi.mock("@/components/chat/ChatPanel", () => ({
  ChatPanel: ({ onActivityChange }: { onActivityChange?: (activity: ChatActivity) => void }) => {
    chatPanelRenders += 1;
    reportActivity = onActivityChange;
    return <div data-testid="chat-panel" />;
  },
}));

import { AssistantSheet } from "./AssistantSheet";

afterEach(() => {
  cleanup();
  chatPanelRenders = 0;
  reportActivity = undefined;
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

describe("AssistantSheet peek", () => {
  const answering: ChatActivity = { answering: true, preview: "", failed: false };
  const answered: ChatActivity = { answering: false, preview: "作者的意思是", failed: false };

  function renderAt(snap: SheetSnap, onSnapChange = vi.fn()) {
    const sheet = (next: SheetSnap) => (
      <AssistantSheet snap={next} onSnapChange={onSnapChange} bookId="book-1" onOpenQuote={() => {}} />
    );
    const view = render(sheet(snap));
    return { rerender: (next: SheetSnap) => view.rerender(sheet(next)) };
  }
  const report = (activity: ChatActivity) => act(() => reportActivity!(activity));
  const peek = () => screen.queryByRole("region", { name: t("mobile.assistantPeek") });

  it("shows nothing while the sheet is open, or collapsed with nothing new", () => {
    const { rerender } = renderAt("half");
    report(answering);
    expect(peek()).toBeNull();

    report({ ...answered });
    rerender("collapsed");
    expect(peek()).toBeNull();
  });

  it("shows an answer coming in after the sheet was put away, then that it is ready", () => {
    const { rerender } = renderAt("half");
    report(answering);
    rerender("collapsed");
    expect(screen.getByRole("status").textContent).toBe(t("mobile.peekAnswering"));

    report(answered);
    expect(screen.getByRole("status").textContent).toBe(t("mobile.peekAnswered"));
    expect(peek()!.textContent).toContain("作者的意思是");
  });

  it("says when the answer failed", () => {
    renderAt("collapsed");
    report(answering);
    report({ answering: false, preview: "", failed: true });
    expect(screen.getByRole("status").textContent).toBe(t("mobile.peekFailed"));
  });

  it("brings the sheet back to half on a tap, and is gone once the answer was seen", () => {
    const onSnapChange = vi.fn();
    const { rerender } = renderAt("collapsed", onSnapChange);
    report(answering);
    report(answered);

    fireEvent.click(screen.getByRole("button", { name: t("mobile.peekOpen") }));
    expect(onSnapChange).toHaveBeenCalledWith("half");

    rerender("half");
    rerender("collapsed");
    expect(peek()).toBeNull();
  });

  it("stays dismissed until the next answer", () => {
    renderAt("collapsed");
    report(answering);
    fireEvent.click(screen.getByRole("button", { name: t("mobile.peekDismiss") }));
    expect(peek()).toBeNull();

    report(answered);
    expect(peek()).toBeNull();

    report(answering);
    expect(peek()).not.toBeNull();
  });

  it("doesn't re-render the conversation for its own state", () => {
    renderAt("collapsed");
    const before = chatPanelRenders;
    report(answering);
    report(answered);
    expect(chatPanelRenders).toBe(before);
  });
});
