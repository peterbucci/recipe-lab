import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("connects a popover trigger, focuses content, and dismisses outside", () => {
    render(<PopoverFixture />);
    const trigger = screen.getByRole("button", { name: "Edit details" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Example details" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Detail name" })).toHaveFocus();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog", { name: "Example details" })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Example details" })).toBeNull();
  });

  it("dismisses a popover with Escape and restores its trigger focus", async () => {
    render(<PopoverFixture />);
    const trigger = screen.getByRole("button", { name: "Edit details" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => undefined);
    expect(screen.queryByRole("dialog", { name: "Example details" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("portals a modal dialog, traps focus, locks scrolling, and restores focus", async () => {
    const onClose = vi.fn();
    render(<DialogFixture onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Example dialog" });
    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Last action" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement).toHaveClass("example-backdrop");
    expect(document.body.style.overflow).toBe("hidden");
    expect(first).toHaveFocus();

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await act(async () => undefined);

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Example dialog" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });
});
