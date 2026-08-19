import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditableName } from "./EditableName";

describe("EditableName", () => {
  it("shows the name when set, falling back to id otherwise", () => {
    const { rerender } = render(<EditableName name="My Survey" id="abc123" onSave={() => {}} />);
    expect(screen.getByText("My Survey")).toBeInTheDocument();
    rerender(<EditableName name={null} id="abc123" onSave={() => {}} />);
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("edits and saves a new name on Enter", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableName name="Old" id="abc123" onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Name{Enter}");
    expect(onSave).toHaveBeenCalledWith("New Name");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("cancels editing on Escape without calling onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableName name="Old" id="abc123" onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /rename/i }));
    await user.type(screen.getByRole("textbox"), "{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not save a blank name", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EditableName name="Old" id="abc123" onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });
});
