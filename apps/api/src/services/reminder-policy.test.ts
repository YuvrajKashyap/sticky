import type { ActorContext, ReminderDto, TaskDto } from "@sticky/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { getRuntime } from "../runtime";
import { reconcileTaskReminder, replaceTaskReminder } from "./reminder-policy";

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("../runtime", () => ({
  getRuntime: vi.fn(),
}));

const actor: ActorContext = {
  userId: "8ea2d355-7098-4432-9fff-48d28d5e5e92",
  actorType: "agent",
  actorId: "poke:test",
  credentialId: "41b8022e-69a9-4b62-aaaf-f705f5fcbe1f",
  scopes: new Set(["tasks:read", "tasks:write"]),
  requestId: "reminder-policy-test",
  idempotencyKey: "reminder-policy-test",
  providerUserId: "poke-user",
  accessToken: null,
};

const task: TaskDto = {
  id: "5f1b0634-c870-4b14-a1c7-d9304bd6f564",
  userId: actor.userId,
  listId: "663b0197-6e3c-4a29-b036-ad985c92aef9",
  title: "Timed task",
  details: "",
  color: "sun",
  dueDate: "2099-07-30",
  dueTime: "12:00",
  timezone: "America/Chicago",
  isCompleted: false,
  completedAt: null,
  sortOrder: 1000,
  completedSortOrder: null,
  version: 1,
  createdAt: "2026-07-30T15:00:00.000Z",
  updatedAt: "2026-07-30T15:00:00.000Z",
};

function reminder(overrides: Partial<ReminderDto> = {}): ReminderDto {
  return {
    id: "a1ac3371-633f-4102-b421-a154b07b21a1",
    taskId: task.id,
    kind: "relative",
    remindAt: "2099-07-30T16:50:00.000Z",
    relativeMinutes: 10,
    channels: ["poke"],
    isDefault: true,
    status: "scheduled",
    version: 1,
    ...overrides,
  };
}

function runtime(options: { task?: TaskDto; scheduled?: ReminderDto[] } = {}) {
  const created = reminder();
  const repository = {
    getTask: vi.fn().mockResolvedValue(options.task ?? task),
    listScheduledReminders: vi.fn().mockResolvedValue(options.scheduled ?? []),
    cancelScheduledReminders: vi.fn().mockResolvedValue([]),
    createReminder: vi.fn().mockResolvedValue(created),
    rescheduleReminder: vi.fn().mockImplementation(async (
      _actor,
      id,
      input,
      remindAt,
      settings,
    ) => reminder({
      id,
      kind: input.kind,
      remindAt: remindAt.toISOString(),
      relativeMinutes: input.relativeMinutes ?? null,
      channels: input.channels,
      isDefault: settings?.isDefault ?? false,
    })),
  };
  const workflowUpdate = {
    eq: vi.fn().mockReturnThis(),
  };
  const db = {
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue(workflowUpdate),
    }),
  };
  vi.mocked(getRuntime).mockReturnValue({ repository, db } as never);
  return { repository, created };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(start).mockResolvedValue({ runId: "wrun_default" } as never);
  delete process.env.WORKFLOW_ENABLED;
});

describe("opt-in agent reminder policy", () => {
  it("leaves a timed task reminder-free until the user explicitly enables one", async () => {
    const { repository } = runtime();

    const result = await reconcileTaskReminder(actor, task.id);

    expect(repository.createReminder).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(result).toMatchObject({ action: "disabled" });
  });

  it("keeps an explicit relative offset and rebases it when the task time changes", async () => {
    const custom = reminder({
      isDefault: false,
      relativeMinutes: 60,
      remindAt: "2099-07-30T16:00:00.000Z",
    });
    const { repository } = runtime({
      task: { ...task, dueTime: "13:00" },
      scheduled: [custom],
    });

    const result = await reconcileTaskReminder(actor, task.id);

    expect(repository.createReminder).not.toHaveBeenCalled();
    expect(repository.rescheduleReminder).toHaveBeenCalledWith(
      actor,
      custom.id,
      { kind: "relative", relativeMinutes: 60, channels: ["poke"] },
      new Date("2099-07-30T17:00:00.000Z"),
      { isDefault: false },
    );
    expect(result.action).toBe("rescheduled");
  });

  it("replaces the automatic reminder instead of stacking another reminder", async () => {
    const { repository } = runtime({ scheduled: [reminder()] });

    await replaceTaskReminder(actor, task.id, {
      kind: "relative",
      relativeMinutes: 30,
      channels: ["poke"],
    });

    expect(repository.cancelScheduledReminders).toHaveBeenCalledWith(actor, task.id);
    expect(repository.createReminder).toHaveBeenCalledWith(
      actor,
      task.id,
      { kind: "relative", relativeMinutes: 30, channels: ["poke"] },
      new Date("2099-07-30T16:30:00.000Z"),
    );
  });

  it("supports an explicit Poke reminder at the task due time", async () => {
    const { repository } = runtime();

    await replaceTaskReminder(actor, task.id, {
      kind: "relative",
      relativeMinutes: 0,
      channels: ["poke"],
    });

    expect(repository.createReminder).toHaveBeenCalledWith(
      actor,
      task.id,
      { kind: "relative", relativeMinutes: 0, channels: ["poke"] },
      new Date("2099-07-30T17:00:00.000Z"),
    );
  });
});
