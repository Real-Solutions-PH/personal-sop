"use client"

import { HttpAgent } from "@ag-ui/client"
import { CopilotKitProvider } from "@copilotkit/react-core/v2"
import "@copilotkit/react-core/v2/styles.css"
import { useMemo } from "react"
import ChatPage from "@/components/Chat/ChatPage"
import { AGENT_IDS } from "@/lib/agents"
import { resolveApiBaseUrl } from "@/lib/env"
import { createClient } from "@/lib/supabase/client"

/**
 * AG-UI agent that attaches a fresh Supabase access token to every run
 * (ADR-0007). Reading the session per run — instead of snapshotting the
 * token once at mount — means supabase-js's automatic refresh keeps long
 * chat sessions authenticated.
 */
class SupabaseHttpAgent extends HttpAgent {
  override async runAgent(...args: Parameters<HttpAgent["runAgent"]>) {
    const { data } = await createClient().auth.getSession()
    this.headers = {
      ...this.headers,
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    }
    return super.runAgent(...args)
  }
}

export default function Chat() {
  const agents = useMemo(() => {
    const apiUrl = resolveApiBaseUrl()
    return Object.fromEntries(
      AGENT_IDS.map((name) => [
        name,
        new SupabaseHttpAgent({
          url: `${apiUrl}/api/v1/copilotkit/agents/${name}`,
        }),
      ]),
    )
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Chat</h1>
        <p className="text-muted-foreground">Chat with AI agents</p>
      </div>
      <CopilotKitProvider selfManagedAgents={agents}>
        <ChatPage />
      </CopilotKitProvider>
    </div>
  )
}
