import { describe, expect, it } from "vitest";
import {
  assessWorkflowDrift,
  hashWorkflowDefinition,
  loadCheckedInWorkflow,
  readHistoryLatestMeta,
  readHistoryLatestVersion,
  readLiveWorkflowContentHash,
  resolveWorkflowsKeeperhubDir,
  WORKFLOW_FILE_BY_ENV,
} from "../services/keeperhub-workflow-drift.ts";

describe("readHistoryLatestMeta / bare-array parsing", () => {
  it("parses paginated { items } responses", () => {
    const body = {
      items: [
        { version: 1, contentHash: "aaa" },
        { version: 3, contentHash: "ccc" },
        { version: 2, contentHash: "bbb" },
      ],
      total: 3,
    };
    expect(readHistoryLatestVersion(body)).toBe(3);
    expect(readHistoryLatestMeta(body)).toEqual({
      version: 3,
      contentHash: "ccc",
    });
  });

  it("parses paginated { data } responses", () => {
    expect(
      readHistoryLatestVersion({
        data: [{ version: 1 }, { version: 4 }],
      }),
    ).toBe(4);
  });

  it("parses bare array history responses (does not early-return null)", () => {
    const body = [
      { version: 1, contentHash: "old" },
      { version: 5, contentHash: "newest" },
      { version: 2, content_hash: "snake" },
    ];
    expect(readHistoryLatestVersion(body)).toBe(5);
    expect(readHistoryLatestMeta(body)).toEqual({
      version: 5,
      contentHash: "newest",
    });
  });

  it("returns nulls for empty / non-history bodies", () => {
    expect(readHistoryLatestMeta(null)).toEqual({
      version: null,
      contentHash: null,
    });
    expect(readHistoryLatestMeta({})).toEqual({
      version: null,
      contentHash: null,
    });
    expect(readHistoryLatestMeta([])).toEqual({
      version: null,
      contentHash: null,
    });
    expect(readHistoryLatestMeta("oops")).toEqual({
      version: null,
      contentHash: null,
    });
  });

  it("ignores rows without numeric version", () => {
    expect(
      readHistoryLatestVersion([
        { version: "1" },
        { version: 2 },
        { notVersion: 9 },
      ]),
    ).toBe(2);
  });
});

describe("hashWorkflowDefinition", () => {
  const nodes = [
    {
      id: "trigger-manual",
      type: "trigger",
      position: { x: 1, y: 2 },
      data: { type: "trigger", label: "Manual", config: { triggerType: "Manual" } },
    },
  ];
  const edges = [
    {
      id: "e1",
      source: "a",
      target: "b",
      sourceHandle: null,
      targetHandle: null,
      style: { stroke: "red" },
    },
  ];

  it("is stable and ignores cosmetic position/style fields", () => {
    const a = hashWorkflowDefinition(nodes, edges);
    const b = hashWorkflowDefinition(
      [
        {
          ...nodes[0],
          position: { x: 999, y: 999 },
          selected: true,
        },
      ],
      [{ ...edges[0], animated: true, style: { stroke: "blue" } }],
    );
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });

  it("changes when behavioral node data changes", () => {
    const base = hashWorkflowDefinition(nodes, edges);
    const changed = hashWorkflowDefinition(
      [
        {
          ...nodes[0],
          data: {
            type: "trigger",
            label: "Manual",
            config: { triggerType: "Webhook" },
          },
        },
      ],
      edges,
    );
    expect(changed).not.toBe(base);
  });
});

describe("readLiveWorkflowContentHash", () => {
  it("hashes nodes/edges from a live workflow body", () => {
    const hash = readLiveWorkflowContentHash({
      id: "wf_1",
      name: "Test",
      nodes: [{ id: "n1", type: "trigger", data: { type: "trigger" } }],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      hashWorkflowDefinition(
        [{ id: "n1", type: "trigger", data: { type: "trigger" } }],
        [{ id: "e1", source: "n1", target: "n2" }],
      ),
    ).toBe(hash);
  });

  it("returns null when nodes are absent", () => {
    expect(readLiveWorkflowContentHash({ id: "wf_1" })).toBeNull();
    expect(readLiveWorkflowContentHash(null)).toBeNull();
  });
});

describe("loadCheckedInWorkflow", () => {
  it("loads a real checked-in workflow from workflows/keeperhub", () => {
    const dir = resolveWorkflowsKeeperhubDir();
    expect(dir).toBeTruthy();

    const loaded = loadCheckedInWorkflow(
      "KEEPERHUB_WORKFLOW_PUBLISH_ALERT",
      dir,
    );
    expect(loaded).not.toBeNull();
    expect(loaded!.fileName).toBe(
      WORKFLOW_FILE_BY_ENV.KEEPERHUB_WORKFLOW_PUBLISH_ALERT,
    );
    expect(loaded!.exportVersion).toBe(1);
    expect(loaded!.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded!.nodeCount).toBeGreaterThan(0);
  });

  it("returns null for unmapped env keys", () => {
    expect(loadCheckedInWorkflow("KEEPERHUB_WORKFLOW_DOES_NOT_EXIST")).toBeNull();
  });
});

describe("assessWorkflowDrift", () => {
  const checkedIn = {
    envKey: "KEEPERHUB_WORKFLOW_PUBLISH_ALERT",
    fileName: "chronicle-publish-alert.workflow.json",
    filePath: "/tmp/chronicle-publish-alert.workflow.json",
    exportVersion: 1,
    name: "Publish Alert",
    contentHash: "abc123def456".padEnd(64, "0"),
    nodeCount: 2,
    edgeCount: 1,
  };

  it("PASS when live content hash matches checked-in", () => {
    const result = assessWorkflowDrift({
      envKey: checkedIn.envKey,
      required: true,
      listingVersion: 1,
      historyVersion: 1,
      historyContentHash: checkedIn.contentHash,
      liveContentHash: checkedIn.contentHash,
      checkedIn,
    });
    expect(result.status).toBe("match");
    expect(result.checkStatus).toBe("PASS");
    expect(result.contentMatch).toBe(true);
    expect(result.versionMatch).toBe(true);
  });

  it("FAIL content drift for required workflows", () => {
    const result = assessWorkflowDrift({
      envKey: checkedIn.envKey,
      required: true,
      listingVersion: 2,
      historyVersion: 3,
      historyContentHash: "deadbeef",
      liveContentHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      checkedIn,
    });
    expect(result.status).toBe("drift");
    expect(result.checkStatus).toBe("FAIL");
    expect(result.contentMatch).toBe(false);
    expect(result.detail).toMatch(/CONTENT DRIFT/);
  });

  it("WARN content drift for optional workflows", () => {
    const result = assessWorkflowDrift({
      envKey: checkedIn.envKey,
      required: false,
      listingVersion: 1,
      historyVersion: 1,
      historyContentHash: null,
      liveContentHash: "0".repeat(64),
      checkedIn,
    });
    expect(result.status).toBe("drift");
    expect(result.checkStatus).toBe("WARN");
  });

  it("WARN version-only drift when content hash is unavailable", () => {
    const result = assessWorkflowDrift({
      envKey: checkedIn.envKey,
      required: true,
      listingVersion: 4,
      historyVersion: 4,
      historyContentHash: null,
      liveContentHash: null,
      checkedIn,
    });
    expect(result.status).toBe("drift");
    expect(result.checkStatus).toBe("WARN");
    expect(result.versionMatch).toBe(false);
    expect(result.contentMatch).toBeNull();
    expect(result.detail).toMatch(/version DRIFT/);
  });

  it("PASS version-only match when content hash is unavailable", () => {
    const result = assessWorkflowDrift({
      envKey: checkedIn.envKey,
      required: true,
      listingVersion: 1,
      historyVersion: 1,
      historyContentHash: null,
      liveContentHash: null,
      checkedIn,
    });
    expect(result.status).toBe("match");
    expect(result.checkStatus).toBe("PASS");
    expect(result.versionMatch).toBe(true);
  });

  it("WARN when checked-in file is missing", () => {
    const result = assessWorkflowDrift({
      envKey: "KEEPERHUB_WORKFLOW_PUBLISH_ALERT",
      required: true,
      listingVersion: 1,
      historyVersion: 1,
      historyContentHash: null,
      liveContentHash: null,
      checkedIn: null,
    });
    expect(result.status).toBe("unknown");
    expect(result.checkStatus).toBe("WARN");
    expect(result.detail).toMatch(/missing|mapping/i);
  });

  it("prefers liveContentHash over historyContentHash", () => {
    const result = assessWorkflowDrift({
      envKey: checkedIn.envKey,
      required: true,
      listingVersion: 1,
      historyVersion: 1,
      historyContentHash: "wrong".padEnd(64, "0"),
      liveContentHash: checkedIn.contentHash,
      checkedIn,
    });
    expect(result.status).toBe("match");
    expect(result.contentMatch).toBe(true);
  });
});
