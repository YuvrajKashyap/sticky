import { localDateKey } from "@/lib/sticky/recurrence";
import type { StickyWorkspaceData } from "@/types/sticky";

const now = new Date();
const todayKey = localDateKey(now);

function iso(minutesAgo = 0) {
  return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

export function createDemoWorkspaceData(): StickyWorkspaceData {
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
        createdAt: iso(360),
        updatedAt: iso(8),
      },
      {
        id: launchId,
        userId,
        name: "Launch polish",
        color: "coral",
        sortOrder: 2000,
        createdAt: iso(340),
        updatedAt: iso(12),
      },
      {
        id: homeId,
        userId,
        name: "Home",
        color: "mint",
        sortOrder: 3000,
        createdAt: iso(330),
        updatedAt: iso(30),
      },
    ],
    tasks: [
      {
        id: inboxTaskId,
        userId,
        listId: todayId,
        title: "Clear the capture tray",
        details: "Turn loose ideas into real stickies before lunch.",
        color: "sky",
        dueDate: todayKey,
        dueTime: "11:30",
        timezone: "America/Chicago",
        isCompleted: false,
        completedAt: null,
        sortOrder: 1000,
        completedSortOrder: null,
        createdAt: iso(120),
        updatedAt: iso(12),
      },
      {
        id: polishTaskId,
        userId,
        listId: todayId,
        title: "Make the details sheet feel expensive",
        details: "Sharper labels, cleaner due controls, and a recurrence foundation that is obvious without being noisy.",
        color: "violet",
        dueDate: null,
        dueTime: null,
        timezone: "America/Chicago",
        isCompleted: false,
        completedAt: null,
        sortOrder: 2000,
        completedSortOrder: null,
        createdAt: iso(100),
        updatedAt: iso(20),
      },
      {
        id: recurringTaskId,
        userId,
        listId: todayId,
        title: "Daily planning pass",
        details: "No subtasks on repeating stickies. Keep it fast.",
        color: "sun",
        dueDate: todayKey,
        dueTime: "09:00",
        timezone: "America/Chicago",
        isCompleted: false,
        completedAt: null,
        sortOrder: 3000,
        completedSortOrder: null,
        createdAt: iso(80),
        updatedAt: iso(5),
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
        completedAt: iso(22),
        sortOrder: 4000,
        completedSortOrder: 1000,
        createdAt: iso(180),
        updatedAt: iso(22),
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
        createdAt: iso(80),
        updatedAt: iso(15),
      },
    ],
    subtasks: [
      {
        id: "demo-subtask-empty",
        userId,
        taskId: inboxTaskId,
        title: "Sort inbox into Today and Launch",
        isCompleted: true,
        completedAt: iso(16),
        sortOrder: 1000,
        createdAt: iso(70),
        updatedAt: iso(16),
      },
      {
        id: "demo-subtask-priority",
        userId,
        taskId: inboxTaskId,
        title: "Pull one sticky to the top",
        isCompleted: false,
        completedAt: null,
        sortOrder: 2000,
        createdAt: iso(65),
        updatedAt: iso(18),
      },
      {
        id: "demo-subtask-sheet",
        userId,
        taskId: polishTaskId,
        title: "Check mobile bottom sheet",
        isCompleted: false,
        completedAt: null,
        sortOrder: 1000,
        createdAt: iso(60),
        updatedAt: iso(18),
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
        createdAt: iso(80),
        updatedAt: iso(5),
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
