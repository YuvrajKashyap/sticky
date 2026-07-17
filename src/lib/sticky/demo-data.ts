import { localDateKey } from "@/lib/sticky/recurrence";
import type { StickyColor, StickyTask, StickyWorkspaceData } from "@/types/sticky";

function iso(now: Date, minutesAgo = 0) {
  return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

export function createDemoWorkspaceData(): StickyWorkspaceData {
  const now = new Date();
  const todayKey = localDateKey(now);
  const userId = "demo-user";
  const remindersId = "demo-list-reminders";
  const nextId = "demo-list-next";
  const bringId = "demo-list-bring";
  const productId = "demo-list-product";
  const financeId = "demo-list-finance";
  const booksId = "demo-list-books";
  const captureTaskId = "demo-task-capture-tray";
  const detailsTaskId = "demo-task-details-panel";
  const recurringTaskId = "demo-task-daily-planning";

  const makeTask = ({
    id,
    listId,
    title,
    details = "",
    color = "sun",
    dueDate = null,
    dueTime = null,
    isCompleted = false,
    sortOrder,
    completedSortOrder = null,
    minutesAgo = 40,
  }: {
    id: string;
    listId: string;
    title: string;
    details?: string;
    color?: StickyColor;
    dueDate?: string | null;
    dueTime?: string | null;
    isCompleted?: boolean;
    sortOrder: number;
    completedSortOrder?: number | null;
    minutesAgo?: number;
  }): StickyTask => ({
    id,
    userId,
    listId,
    title,
    details,
    color,
    dueDate,
    dueTime,
    timezone: "America/Chicago",
    isCompleted,
    completedAt: isCompleted ? iso(now, minutesAgo) : null,
    sortOrder,
    completedSortOrder: isCompleted ? completedSortOrder ?? sortOrder : null,
    createdAt: iso(now, minutesAgo + 90),
    updatedAt: iso(now, minutesAgo),
  });

  const reminderTasks: StickyTask[] = [
    makeTask({
      id: captureTaskId,
      listId: remindersId,
      title: "Clear the capture tray",
      details: "Turn loose ideas into real tasks before lunch.",
      color: "sky",
      dueDate: todayKey,
      dueTime: "11:30",
      sortOrder: 1000,
      minutesAgo: 12,
    }),
    makeTask({
      id: detailsTaskId,
      listId: remindersId,
      title: "Tighten the details panel",
      details: "Keep dates, subtasks, and repeat settings easy to scan.",
      color: "violet",
      sortOrder: 2000,
      minutesAgo: 20,
    }),
    makeTask({
      id: recurringTaskId,
      listId: remindersId,
      title: "Daily planning pass",
      details: "Pick the three outcomes that matter most today.",
      color: "sun",
      dueDate: todayKey,
      dueTime: "09:00",
      sortOrder: 3000,
      minutesAgo: 5,
    }),
    makeTask({
      id: "demo-task-review-launch",
      listId: remindersId,
      title: "Review the launch checklist",
      details: "Confirm the demo, docs, and mobile flow are ready to share.",
      color: "mint",
      sortOrder: 4000,
      minutesAgo: 18,
    }),
    ...[
      "Set the week’s priorities",
      "Clean up the project board",
      "Confirm keyboard shortcuts",
      "Review empty states",
      "Check the install experience",
      "Test the recurring-task flow",
      "Verify accessible labels",
      "Capture the release notes",
    ].map((title, index) =>
      makeTask({
        id: `demo-task-reminders-completed-${index + 1}`,
        listId: remindersId,
        title,
        color: (['sun', 'mint', 'sky', 'violet'] as const)[index % 4],
        isCompleted: true,
        sortOrder: 5000 + index * 1000,
        completedSortOrder: 1000 + index * 1000,
        minutesAgo: 36 - index,
      }),
    ),
  ];

  const nextTasks = [
    makeTask({
      id: "demo-task-domain",
      listId: nextId,
      title: "Prepare the Vercel domain checklist",
      details: "Check DNS, redirects, environment variables, and preview URLs.",
      color: "coral",
      sortOrder: 1000,
    }),
    makeTask({
      id: "demo-task-mobile",
      listId: nextId,
      title: "Verify the mobile workspace",
      details: "Run capture, edit, complete, restore, and reload on a narrow viewport.",
      color: "sky",
      sortOrder: 2000,
    }),
    makeTask({
      id: "demo-task-reminder-flow",
      listId: nextId,
      title: "Exercise reminder delivery",
      details: "Schedule, snooze, and dismiss a private reminder.",
      color: "violet",
      sortOrder: 3000,
    }),
    makeTask({
      id: "demo-task-showcase",
      listId: nextId,
      title: "Capture the showcase workspace",
      details: "Use real UI and intentional demo data for the portfolio preview.",
      color: "mint",
      sortOrder: 4000,
    }),
  ];

  const bringTasks = [
    makeTask({ id: "demo-task-bring-notebook", listId: bringId, title: "Notebook", color: "mint", sortOrder: 1000 }),
    makeTask({ id: "demo-task-bring-charger", listId: bringId, title: "Laptop charger", color: "sun", sortOrder: 2000 }),
    makeTask({ id: "demo-task-bring-badge", listId: bringId, title: "Event badge", color: "sky", sortOrder: 3000 }),
    makeTask({
      id: "demo-task-bring-completed",
      listId: bringId,
      title: "Headphones",
      color: "violet",
      isCompleted: true,
      sortOrder: 4000,
      completedSortOrder: 1000,
    }),
  ];

  const productTasks = [
    "Polish the command center",
    "Review empty and loading states",
    "Check drag-and-drop feedback",
    "Audit the task filter copy",
    "Write the architecture overview",
  ].map((title, index) =>
    makeTask({
      id: `demo-task-product-${index + 1}`,
      listId: productId,
      title,
      color: (['coral', 'violet', 'mint', 'sky', 'sun'] as const)[index],
      sortOrder: (index + 1) * 1000,
      minutesAgo: 30 - index,
    }),
  );

  const financeTasks = [
    makeTask({ id: "demo-task-finance-budget", listId: financeId, title: "Reconcile the monthly budget", color: "mint", sortOrder: 1000 }),
    makeTask({ id: "demo-task-finance-renewals", listId: financeId, title: "Review upcoming renewals", color: "sky", sortOrder: 2000 }),
  ];

  const booksTasks = [
    "Designing Data-Intensive Applications",
    "The Design of Everyday Things",
    "Staff Engineer",
    "Shape Up",
    "Refactoring UI",
    "The Mom Test",
    "Creativity, Inc.",
    "Inspired",
    "Thinking in Systems",
    "The Pragmatic Programmer",
    "Build",
    "Range",
  ].map((title, index) =>
    makeTask({
      id: `demo-task-book-${index + 1}`,
      listId: booksId,
      title,
      color: (['ink', 'sky', 'mint', 'violet'] as const)[index % 4],
      sortOrder: (index + 1) * 1000,
      minutesAgo: 24 - index,
    }),
  );

  return {
    user: {
      id: userId,
      email: "demo@sticky.local",
      displayName: "Demo User",
      role: "owner",
    },
    lists: [
      { id: remindersId, userId, name: "reminders", color: "sun", sortOrder: 1000, isVisibleOnBoard: true, archivedAt: null, createdAt: iso(now, 360), updatedAt: iso(now, 8) },
      { id: nextId, userId, name: "Next 3", color: "sky", sortOrder: 2000, isVisibleOnBoard: true, archivedAt: null, createdAt: iso(now, 340), updatedAt: iso(now, 12) },
      { id: bringId, userId, name: "bring", color: "mint", sortOrder: 3000, isVisibleOnBoard: true, archivedAt: null, createdAt: iso(now, 330), updatedAt: iso(now, 30) },
      { id: productId, userId, name: "Product", color: "coral", sortOrder: 4000, isVisibleOnBoard: true, archivedAt: null, createdAt: iso(now, 320), updatedAt: iso(now, 18) },
      { id: financeId, userId, name: "Finance", color: "violet", sortOrder: 5000, isVisibleOnBoard: true, archivedAt: null, createdAt: iso(now, 310), updatedAt: iso(now, 22) },
      { id: booksId, userId, name: "Books", color: "ink", sortOrder: 6000, isVisibleOnBoard: true, archivedAt: null, createdAt: iso(now, 300), updatedAt: iso(now, 20) },
    ],
    tasks: [...reminderTasks, ...nextTasks, ...bringTasks, ...productTasks, ...financeTasks, ...booksTasks],
    subtasks: [
      { id: "demo-subtask-sort", userId, taskId: captureTaskId, title: "Sort the loose notes", isCompleted: true, completedAt: iso(now, 16), sortOrder: 1000, createdAt: iso(now, 70), updatedAt: iso(now, 16) },
      { id: "demo-subtask-priority", userId, taskId: captureTaskId, title: "Pull one priority to the top", isCompleted: false, completedAt: null, sortOrder: 2000, createdAt: iso(now, 65), updatedAt: iso(now, 18) },
      { id: "demo-subtask-mobile", userId, taskId: detailsTaskId, title: "Check the mobile sheet", isCompleted: false, completedAt: null, sortOrder: 1000, createdAt: iso(now, 60), updatedAt: iso(now, 18) },
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
      completedOpenByList: { [remindersId]: false },
      density: "comfortable",
      colorMode: "light",
      boardStyle: "pad",
      taskViewFilter: "all",
      taskSortMode: "custom",
    },
    userState: { selectedListId: remindersId, searchQuery: "" },
  };
}
