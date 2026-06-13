import { AuthPanel } from "@/components/auth/AuthPanel";
import { StickyWorkspace } from "@/components/sticky/StickyWorkspace";
import { loadWorkspace } from "@/lib/sticky/server";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const authMessage = firstParam(params?.auth_error);
  const workspace = await loadWorkspace();

  if (workspace.status === "ready") {
    return <StickyWorkspace initialData={workspace.data} mode="supabase" />;
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
