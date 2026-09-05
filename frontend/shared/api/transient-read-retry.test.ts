import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isTransientReadFailure,
  retryTransientRead,
  TRANSIENT_READ_RETRY_DELAY_MS,
} from "./transient-read-retry";

afterEach(() => {
  vi.useRealTimers();
});

describe("transient read retry", () => {
  it("returns a successful first read without retrying", async () => {
    const read = vi.fn().mockResolvedValue({ items: ["recipe"] });

    await expect(retryTransientRead(read)).resolves.toEqual({
      items: ["recipe"],
    });
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([502, 503, 504])(
    "retries one HTTP %i failure after the bounded delay",
    async (status) => {
      vi.useFakeTimers();
      const read = vi
        .fn()
        .mockRejectedValueOnce({ status, code: "recipe_api_error" })
        .mockResolvedValueOnce("loaded");

      const request = retryTransientRead(read);
      await vi.advanceTimersByTimeAsync(TRANSIENT_READ_RETRY_DELAY_MS);

      await expect(request).resolves.toBe("loaded");
      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  it("retries wrapped network and timeout failures", async () => {
    vi.useFakeTimers();
    const networkRead = vi
      .fn()
      .mockRejectedValueOnce({ status: 0, code: "network_error" })
      .mockResolvedValueOnce("network recovered");
    const timeoutRead = vi
      .fn()
      .mockRejectedValueOnce({ status: 0, reason: "timeout" })
      .mockResolvedValueOnce("timeout recovered");

    const networkRequest = retryTransientRead(networkRead);
    await vi.advanceTimersByTimeAsync(TRANSIENT_READ_RETRY_DELAY_MS);
    await expect(networkRequest).resolves.toBe("network recovered");

    const timeoutRequest = retryTransientRead(timeoutRead);
    await vi.advanceTimersByTimeAsync(TRANSIENT_READ_RETRY_DELAY_MS);
    await expect(timeoutRequest).resolves.toBe("timeout recovered");
  });

  it("recognizes standard raw fetch network failures without treating arbitrary TypeErrors as transient", () => {
    expect(isTransientReadFailure(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientReadFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientReadFailure(new TypeError("Cannot read properties of null"))).toBe(false);
  });

  it.each([
    { status: 400, code: "validation_error" },
    { status: 401, code: "authentication_required" },
    { status: 429, code: "rate_limit_exceeded" },
    { status: 502, code: "invalid_api_response" },
    { status: 502, code: "invalid_recipe_library_response" },
  ])("does not retry a non-transient failure %#", async (failure) => {
    const read = vi.fn().mockRejectedValue(failure);

    await expect(retryTransientRead(read)).rejects.toBe(failure);
    expect(read).toHaveBeenCalledOnce();
  });

  it("makes only one retry when the transient failure continues", async () => {
    vi.useFakeTimers();
    const failure = { status: 503, code: "api_error" };
    const read = vi.fn().mockRejectedValue(failure);

    const request = retryTransientRead(read);
    const expectation = expect(request).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(TRANSIENT_READ_RETRY_DELAY_MS);

    await expectation;
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not start a read when its signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Navigation changed.", "AbortError");
    controller.abort(reason);
    const read = vi.fn().mockResolvedValue("unused");

    await expect(
      retryTransientRead(read, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(read).not.toHaveBeenCalled();
  });

  it("cancels the retry delay and preserves the caller's abort reason", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new DOMException("Navigation changed.", "AbortError");
    const read = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, code: "api_error" })
      .mockResolvedValueOnce("unused");

    const request = retryTransientRead(read, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);

    await expect(request).rejects.toBe(reason);
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not retry a read aborted while its first attempt is in flight", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Navigation changed.", "AbortError");
    const read = vi.fn((signal?: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    );

    const request = retryTransientRead(read, { signal: controller.signal });
    const expectation = expect(request).rejects.toBe(reason);
    controller.abort(reason);

    await expectation;
    expect(read).toHaveBeenCalledOnce();
  });

  it("passes the caller signal to both attempts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const read = vi
      .fn()
      .mockRejectedValueOnce({ status: 504, code: "api_error" })
      .mockResolvedValueOnce("loaded");

    const request = retryTransientRead(read, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(TRANSIENT_READ_RETRY_DELAY_MS);

    await expect(request).resolves.toBe("loaded");
    expect(read).toHaveBeenNthCalledWith(1, controller.signal);
    expect(read).toHaveBeenNthCalledWith(2, controller.signal);
  });
});
