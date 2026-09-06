import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, Popover, PopoverContent, PopoverTrigger } from "./overlay-primitives";

function PopoverFixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger contentId="example-popover" aria-haspopup="dialog">
          Edit details
        </PopoverTrigger>
        <PopoverContent
          id="example-popover"
          aria-label="Example details"
          initialFocus="first"
        >
          <input aria-label="Detail name" />
          <button type="button">Save</button>
        </PopoverContent>
      </Popover>
      <button type="button">Outside</button>
    </>
  );
}

function DialogFixture({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Dialog
        aria-label="Example dialog"
        backdropClassName="example-backdrop"
        className="example-dialog"
        open={open}
        restoreFocusRef={triggerRef}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) onClose();
        }}
      >
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Dialog>
    </>
  );
}

describe("overlay primitives", () => {
  it("connects a popover trigger, focuses content, and dismisses outside", async () => {
    const user = userEvent.setup();
    render(<PopoverFixture />);
    const trigger = screen.getByRole("button", { name: "Edit details" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Example details" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Detail name" })).toHaveFocus();

    await user.pointer({
      keys: "[MouseLeft]",
      target: screen.getByRole("button", { name: "Save" }),
    });
    expect(screen.getByRole("dialog", { name: "Example details" })).toBeVisible();
    await user.pointer({ keys: "[MouseLeft]", target: document.body });
    expect(screen.queryByRole("dialog", { name: "Example details" })).toBeNull();
  });

  it("dismisses a popover with Escape and restores its trigger focus", async () => {
    const user = userEvent.setup();
    render(<PopoverFixture />);
    const trigger = screen.getByRole("button", { name: "Edit details" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Example details" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("portals a modal dialog, traps focus, locks scrolling, and restores focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogFixture onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Example dialog" });
    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Last action" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement).toHaveClass("example-backdrop");
    expect(document.body.style.overflow).toBe("hidden");
    expect(first).toHaveFocus();

    await user.click(last);
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Example dialog" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });
});
