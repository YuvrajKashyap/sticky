import { localDateKey } from "@/lib/sticky/recurrence";
import type { StickyWorkspaceData } from "@/types/sticky";

function iso(now: Date, minutesAgo = 0) {
  return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

export function createDemoWorkspaceData(): StickyWorkspaceData {
  const now = new Date();
  const todayKey = localDateKey(now);
  const userId = "demo-user";
  const todayId = "demo-list-today";
  const launchId = "demo-list-launch";
  const homeId = "demo-list-home";
  const inboxTaskId = "demo-task-inbox";
  const polishTaskId = "demo-task-polish";
  const recurringTaskId = "demo-task-recurring";
  const completedTaskId = "demo-task-completed";

  return {
    user: {
      id: userId,
      email: "demo@sticky.local",
      displayName: "Demo workspace",
      role: "owner",
    },
    lists: [
      {
        id: todayId,
        userId,
        name: "Today",
        color: "sun",
        sortOrder: 1000,
        createdAt: iso(now, 360),
        updatedAt: iso(now, 8),
      },
      {
        id: launchId,
        userId,
        name: "Launch polish",
        color: "coral",
        sortOrder: 2000,
        createdAt: iso(now, 340),
        updatedAt: iso(now, 12),
      },
      {
        id: homeId,
        userId,
        name: "Home",
        color: "mint",
        sortOrder: 3000,
        createdAt: iso(now, 330),
        updatedAt: iso(now, 30),
      },
    ],
    tasks: [
      {
        id: inboxTaskId,
        userId,
        listId: todayId,
        title: "Clear the capture tray",
        details: "Turn loose ideas into real tasks before lunch.",
        color: "sky",
        dueDate: todayKey,
        dueTime: "11:30",
        timezone: "America/Chicago",
        isCompleted: false,
        completedAt: null,
        sortOrder: 1000,
        completedSortOrder: null,
        createdAt: iso(now, 120),
        updatedAt: iso(now, 12),
      },
      {
        id: polishTaskId,
        userId,
        listId: todayId,
        title: "Tighten the details panel",
        details: "Sharper labels, cleaner due controls, and repeat settings that stay out of the way.",
        color: "violet",
        dueDate: null,
        dueTime: null,
        timezone: "America/Chicago",
        isCompleted: false,
        completedAt: null,
        sortOrder: 2000,
        completedSortOrder: null,
        createdAt: iso(now, 100),
        updatedAt: iso(now, 20),
      },
      {
        id: recurringTaskId,
        userId,
        listId: todayId,
        title: "Daily planning pass",
        details: "No subtasks on repeating tasks. Keep it fast.",
        color: "sun",
        dueDate: todayKey,
        dueTime: "09:00",
        timezone: "America/Chicago",
        isCompleted: false,
        completedAt: null,
        sortOrder: 3000,
        completedSortOrder: null,
        createdAt: iso(now, 80),
        updatedAt: iso(now, 5),
      },
      {
        id: completedTaskId,
        userId,
        listId: todayId,
        title: "Sketch first pass motion",
        details: "Completion pulse and drag lift are both wired.",
        color: "mint",
        dueDate: null,
        dueTime: null,
        timezone: "America/Chicago",
        isCompleted: true,
        completedAt: iso(now, 22),
        sortOrder: 4000,
        completedSortOrder: 1000,
        createdAt: iso(now, 180),
        updatedAt: iso(now, 22),
      },
      {
        id: "demo-task-marketing",
        userId,
        listId: launchId,
        title: "Prepare Vercel domain checklist",
        details: "Env vars, auth redirects, preview URLs, and DNS instructions.",
        color: "coral",
        dueDate: null,
        dueTime: null,
        timezone: "America/Chicago",
        isCompleted: false,
        completedAt: null,
        sortOrder: 1000,
        completedSortOrder: null,
        createdAt: iso(now, 80),
        updatedAt: iso(now, 15),
      },
    ],
    subtasks: [
      {
        id: "demo-subtask-empty",
        userId,
        taskId: inboxTaskId,
        title: "Sort inbox into Today and Launch",
        isCompleted: true,
        completedAt: iso(now, 16),
        sortOrder: 1000,
        createdAt: iso(now, 70),
        updatedAt: iso(now, 16),
      },
      {
        id: "demo-subtask-priority",
        userId,
        taskId: inboxTaskId,
        title: "Pull one task to the top",
        isCompleted: false,
        completedAt: null,
        sortOrder: 2000,
        createdAt: iso(now, 65),
        updatedAt: iso(now, 18),
      },
      {
        id: "demo-subtask-sheet",
        userId,
        taskId: polishTaskId,
        title: "Check mobile bottom sheet",
        isCompleted: false,
        completedAt: null,
        sortOrder: 1000,
        createdAt: iso(now, 60),
        updatedAt: iso(now, 18),
      },
    ],
    recurrenceRules: [
      {
        id: "demo-recurrence-daily",
        userId,
        taskId: recurringTaskId,
        frequency: "daily",
        intervalCount: 1,
        daysOfWeek: [],
        monthDay: null,
        startsOn: todayKey,
        endType: "never",
        endDate: null,
        occurrenceCount: null,
        timezone: "America/Chicago",
        paused: false,
        createdAt: iso(now, 80),
        updatedAt: iso(now, 5),
      },
    ],
    preferences: {
      completedOpenByList: {
        [todayId]: false,
      },
      density: "comfortable",
      colorMode: "system",
      taskViewFilter: "all",
      taskSortMode: "custom",
    },
    userState: {
      selectedListId: todayId,
      searchQuery: "",
    },
  };
}
