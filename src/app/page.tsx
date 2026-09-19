import { AuthPanel } from "@/components/auth/AuthPanel";
import { StickyWorkspace } from "@/components/sticky/StickyWorkspace";
import { loadWorkspace } from "@/lib/sticky/server";
import { cookies } from "next/headers";
import type { StickyLaunchIntent } from "@/types/sticky";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function launchIntentFromParams(
  params: Record<string, string | string[] | undefined> | undefined,
): StickyLaunchIntent | undefined {
  const intent = firstParam(params?.intent);
  const view = firstParam(params?.view);

  if (intent === "capture" || intent === "search" || intent === "today" || intent === "scheduled") {
    return intent;
  }

  if (view === "today") {
    return "today";
  }

  if (view === "scheduled" || view === "due") {
    return "scheduled";
  }

  return undefined;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const authMessage = firstParam(params?.auth_error);
  const initialLaunchIntent = launchIntentFromParams(params);
  // Remembered surfaces come from cookies so the server renders exactly what
  // the user last saw: board or calendar, deck open or not, calendar view and
  // filter. No client-side swap after mount, so nothing flashes.
  const cookieStore = await cookies();
  const initialViewMode = cookieStore.get("sticky.view")?.value === "calendar" ? "calendar" : "board";
  const initialOverviewOpen = cookieStore.get("sticky.deck")?.value === "1";
  const calView = cookieStore.get("sticky.calview")?.value;
  const initialCalendarView = calView === "week" || calView === "day" ? calView : "month";
  const calContent = cookieStore.get("sticky.calcontent")?.value;
  const initialCalendarContent = calContent === "events" || calContent === "tasks" ? calContent : "both";
  const workspace = await loadWorkspace();

  if (workspace.status === "ready") {
    return (
      <StickyWorkspace
        initialData={workspace.data}
        mode="supabase"
        initialLaunchIntent={initialLaunchIntent}
        initialViewMode={initialViewMode}
        initialOverviewOpen={initialOverviewOpen}
        initialCalendarView={initialCalendarView}
        initialCalendarContent={initialCalendarContent}
      />
    );
  }

  if (authMessage) {
    return (
      <AuthPanel
        accessMessage={authMessage}
        configurationMissing={workspace.status === "signed_out" ? workspace.configurationMissing : false}
      />
    );
  }

  if (workspace.status === "demo") {
    return (
      <StickyWorkspace
        initialData={workspace.data}
        mode="demo"
        systemMessage={workspace.reason}
        initialLaunchIntent={initialLaunchIntent}
        initialViewMode={initialViewMode}
        initialOverviewOpen={initialOverviewOpen}
        initialCalendarView={initialCalendarView}
        initialCalendarContent={initialCalendarContent}
      />
    );
  }

  if (workspace.status === "access_denied") {
    return (
      <AuthPanel
        accessMessage={workspace.message}
        configurationMissing={false}
      />
    );
  }

  return (
    <AuthPanel
      configurationMissing={workspace.configurationMissing}
    />
  );
}
