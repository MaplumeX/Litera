// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tip } from "./tooltip";

afterEach(cleanup);

function overflowWidth(el: HTMLElement, scroll: number, client: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scroll });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: client });
}

describe("Tip", () => {
  it("shows its label on keyboard focus without a provider", async () => {
    render(
      <Tip label="新建会话">
        <button type="button">+</button>
      </Tip>,
    );
    await act(async () => fireEvent.focus(screen.getByRole("button")));
    expect(screen.getByRole("tooltip").textContent).toBe("新建会话");
  });

  it("renders the child alone when there is no label", () => {
    const { container } = render(
      <Tip label={undefined}>
        <span>第一章</span>
      </Tip>,
    );
    expect(container.innerHTML).toBe("<span>第一章</span>");
  });

  it("stays quiet with overflowOnly while the text fits", async () => {
    render(
      <Tip label="第一章" overflowOnly>
        <button type="button">第一章</button>
      </Tip>,
    );
    await act(async () => fireEvent.focus(screen.getByRole("button")));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows with overflowOnly once a descendant is cut off", async () => {
    render(
      <Tip label="很长很长的章节标题" overflowOnly>
        <button type="button">
          <span data-testid="text">很长很长的章节标题</span>
        </button>
      </Tip>,
    );
    overflowWidth(screen.getByTestId("text"), 200, 80);
    await act(async () => fireEvent.focus(screen.getByRole("button")));
    expect(screen.getByRole("tooltip").textContent).toBe("很长很长的章节标题");
  });
});
