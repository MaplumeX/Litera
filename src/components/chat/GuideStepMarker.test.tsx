// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuideStepMarker } from "./GuideStepMarker";

afterEach(cleanup);

describe("GuideStepMarker", () => {
  it("shows the step's label and its branch switcher", () => {
    const view = render(
      <GuideStepMarker label="带读：第三章（第 1/3 部分）" branchSwitcher={<span>2/2</span>} />,
    );
    expect(view.getByTestId("guide-step").textContent).toBe("带读：第三章（第 1/3 部分）2/2");
  });
});
