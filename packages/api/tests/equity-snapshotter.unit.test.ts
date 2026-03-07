import { afterEach, describe, expect, it, vi } from "vitest";

const loadModule = async (options?: {
  overview?: Record<string, unknown>;
  recorded?: { created: number; skipped: number };
}) => {
  vi.resetModules();
  const buildAdminOverviewModel = vi.fn().mockResolvedValue(options?.overview ?? { series: [] });
  const recordEquitySnapshotsFromOverview = vi.fn().mockResolvedValue(options?.recorded ?? { created: 2, skipped: 1 });
  const startPeriodicWorker = vi.fn((_config) => () => undefined);

  vi.doMock("../src/services/admin-overview.js", () => ({
    buildAdminOverviewModel,
    recordEquitySnapshotsFromOverview,
  }));
  vi.doMock("../src/workers/periodic-worker.js", () => ({ startPeriodicWorker }));

  const mod = await import("../src/workers/equity-snapshotter.js");
  return { ...mod, buildAdminOverviewModel, recordEquitySnapshotsFromOverview, startPeriodicWorker };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("equity-snapshotter", () => {
  it("builds admin overview without symbol metadata before recording snapshots", async () => {
    const mod = await loadModule({ overview: { series: [{ userId: "usr_1" }] }, recorded: { created: 1, skipped: 0 } });
    const registry = { get: vi.fn() };

    await expect(mod.recordEquitySnapshots(registry as never)).resolves.toEqual({ created: 1, skipped: 0 });
    expect(mod.buildAdminOverviewModel).toHaveBeenCalledWith({ registry, includeSymbolMetadata: false });
    expect(mod.recordEquitySnapshotsFromOverview).toHaveBeenCalledWith({ overview: { series: [{ userId: "usr_1" }] } });
  });

  it("wires the periodic worker and logs only when snapshots were created", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const mod = await loadModule();
    const registry = { get: vi.fn() };

    const stop = mod.startEquitySnapshotter(registry as never);
    expect(typeof stop).toBe("function");
    expect(mod.startPeriodicWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "equity-snapshots",
        defaultIntervalMs: 300_000,
        envVar: "EQUITY_SNAPSHOT_INTERVAL_MS",
      }),
    );

    const config = mod.startPeriodicWorker.mock.calls[0][0];
    await expect(config.run()).resolves.toEqual({ created: 2, skipped: 1 });
    expect(mod.buildAdminOverviewModel).toHaveBeenCalledWith({ registry, includeSymbolMetadata: false });

    config.onResult({ created: 0, skipped: 2 });
    expect(console.log).not.toHaveBeenCalled();

    config.onResult({ created: 2, skipped: 1 });
    expect(console.log).toHaveBeenCalledWith("[equity-snapshots] created 2 snapshots");
  });
});
