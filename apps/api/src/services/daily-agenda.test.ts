import { describe, expect, it } from "vitest";
import { pokeNotificationInstruction } from "./notifications";
import { buildDailyAgendaMessage, type DailyAgendaItems } from "./daily-agenda";

const items: DailyAgendaItems = {
  dueTasks: [{
    id: "task-1",
    listId: "list-1",
    listName: "Software",
    title: "Ship Sticky",
    dueTime: "09:30:00",
    sortOrder: 1000,
  }],
  dueSubtasks: [{
    id: "subtask-1",
    listId: "list-1",
    listName: "Software",
    parentTaskId: "task-2",
    parentTitle: "Projects",
    title: "Racial detection",
    sortOrder: 1000,
  }],
  undatedTasks: [{
    id: "task-3",
    listId: "list-2",
    listName: "Immigration",
    title: "Find O-1 requirements",
    dueTime: null,
    sortOrder: 1000,
  }],
};

describe("daily Poke agenda", () => {
  it("puts due parent tasks and independently dated subtasks before active undated tasks", () => {
    const message = buildDailyAgendaMessage("2026-07-19", "America/Chicago", items, {
      siteUrl: "https://sticky.example.com",
    });

    expect(message).toContain("DUE TODAY (2)");
    expect(message).toContain("Software - Ship Sticky at 9:30 AM");
    expect(message).toContain("Software - Projects\n  ↳ Racial detection");
    expect(message).toContain("ACTIVE WITHOUT A DUE DATE (1)\nImmigration\n• Find O-1 requirements");
    expect(message).toContain("https://sticky.example.com/?view=today");
    expect(message.indexOf("DUE TODAY")).toBeLessThan(message.indexOf("ACTIVE WITHOUT A DUE DATE"));
  });

  it("still sends a useful agenda when both sections are empty", () => {
    const message = buildDailyAgendaMessage("2026-07-19", "America/Chicago", {
      dueTasks: [],
      dueSubtasks: [],
      undatedTasks: [],
    }, { test: true });

    expect(message).toContain("TEST - Sticky daily agenda");
    expect(message).toContain("Nothing is due today.");
    expect(message).toContain("No active undated tasks.");
  });

  it("gives Poke an explicit outbound-notification instruction", () => {
    const instruction = pokeNotificationInstruction("TEST - Sticky daily agenda");

    expect(instruction).toContain("Send me the notification below now as your reply");
    expect(instruction).toContain("Do not modify any tasks");
    expect(instruction).toContain("TEST - Sticky daily agenda");
  });
});
