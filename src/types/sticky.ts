export type StickyColor = "sun" | "coral" | "mint" | "sky" | "violet" | "ink";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export type RecurrenceEndType = "never" | "on_date" | "after_count";

export type AppMode = "supabase" | "demo";

export type StickyTaskViewFilter = "all" | "today" | "due" | "overdue" | "recurring" | "subtasks";

export type StickyTaskSortMode = "custom" | "due";

export type StickyThemeMode = "light" | "dark";

export type StickyBoardStyle = "pad" | "wood";

export type StickyLaunchIntent = "capture" | "search" | "today" | "scheduled";

export type StickyUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: "owner" | "member";
};

export type StickyList = {
  id: string;
  userId: string;
  name: string;
  color: StickyColor;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type StickyTask = {
  id: string;
  userId: string;
  listId: string;
  title: string;
  details: string;
  color: StickyColor;
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
  isCompleted: boolean;
  completedAt: string | null;
  sortOrder: number;
  completedSortOrder: number | null;
  createdAt: string;
  updatedAt: string;
};

export type StickySubtask = {
  id: string;
  userId: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type StickyRecurrenceRule = {
  id: string;
  userId: string;
  taskId: string;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  daysOfWeek: number[];
  monthDay: number | null;
  startsOn: string;
  endType: RecurrenceEndType;
  endDate: string | null;
  occurrenceCount: number | null;
  timezone: string;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StickyPreferences = {
  completedOpenByList: Record<string, boolean>;
  density: "compact" | "comfortable";
  colorMode: StickyThemeMode;
  boardStyle: StickyBoardStyle;
  taskViewFilter: StickyTaskViewFilter;
  taskSortMode: StickyTaskSortMode;
};

export type StickyUserState = {
  selectedListId: string | null;
  searchQuery: string;
};

export type StickyWorkspaceData = {
  user: StickyUser;
  lists: StickyList[];
  tasks: StickyTask[];
  subtasks: StickySubtask[];
  recurrenceRules: StickyRecurrenceRule[];
  preferences: StickyPreferences;
  userState: StickyUserState;
};

export type DbList = {
  id: string;
  user_id: string;
  name: string;
  color: StickyColor;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DbTask = {
  id: string;
  user_id: string;
  list_id: string;
  title: string;
  details: string;
  color: StickyColor;
  due_date: string | null;
  due_time: string | null;
  timezone: string;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  completed_sort_order: number | null;
  created_at: string;
  updated_at: string;
};

export type DbSubtask = {
  id: string;
  user_id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DbRecurrenceRule = {
  id: string;
  user_id: string;
  task_id: string;
  frequency: RecurrenceFrequency;
  interval_count: number;
  days_of_week: number[] | null;
  month_day: number | null;
  starts_on: string;
  end_type: RecurrenceEndType;
  end_date: string | null;
  occurrence_count: number | null;
  timezone: string;
  paused: boolean;
  created_at: string;
  updated_at: string;
};

export type DbUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: "owner" | "member";
};

export type DbUserState = {
  selected_list_id: string | null;
  search_query: string;
};

export type DbUserPreferences = {
  completed_open_by_list: Record<string, boolean> | null;
  density: "compact" | "comfortable";
  color_mode: "system" | "light" | "dark";
  board_style: StickyBoardStyle | null;
  task_view_filter: StickyTaskViewFilter | null;
  task_sort_mode: StickyTaskSortMode | null;
};
