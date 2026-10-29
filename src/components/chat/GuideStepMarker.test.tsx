// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuideStepMarker } from "./GuideStepMarker";

afterEach(cleanup);

describe("GuideStepMarker", () => {
  it("shows the step's label and its branch switcher", () => {
    const view = render(
      <GuideStepMarker label="带读：第三章（第 1/3 部分）" branchSwitcher={<span>2/2</span>} />,
    );
    expect(view.getByTestId("guide-step").textContent).toBe("带读：第三章（第 1/3 部分）2/2");
  });

  it("opens the step's start in the Book, and says when it is not found", async () => {
    const onOpen = vi.fn(async () => false);
    const view = render(<GuideStepMarker label="带读：第三章" onOpen={onOpen} />);
    fireEvent.click(view.getByRole("button", { name: "在书中打开" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(await view.findByRole("button", { name: "未能在书中定位" })).toHaveProperty("disabled", true);
  });
});
