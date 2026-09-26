"use client"

import { CopilotChat } from "@copilotkit/react-core/v2"
import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AGENT_IDS } from "@/lib/agents"

export default function ChatPage() {
  const [agentId, setAgentId] = useState<string>(AGENT_IDS[0])

  return (
    <div className="flex flex-col gap-3">
      <Select value={agentId} onValueChange={setAgentId}>
        <SelectTrigger className="w-56" aria-label="Agent">
          <SelectValue placeholder="Agent" />
        </SelectTrigger>
        <SelectContent>
          {AGENT_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Card className="h-[calc(100vh-18rem)]">
        <CardContent className="h-full p-0 overflow-hidden">
          <CopilotChat
            key={agentId}
            agentId={agentId}
            labels={{
              chatInputPlaceholder: "Type a message...",
              welcomeMessageText: "Hi! How can I help you today?",
            }}
            className="h-full"
          />
        </CardContent>
      </Card>
    </div>
  )
}
