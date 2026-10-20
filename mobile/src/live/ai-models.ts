// The models the server's own AI key (Nebius Token Factory) offers, and its
// defaults. Live mode reads them from GET /ai/providers/presets (the backend's
// checked catalogue); the prototype shows a fixed sample of the same list.

import { useQuery } from "@tanstack/react-query"
import { http } from "./auth"
import { liveMode } from "./config"

export interface OfferedModel {
  id: string
  label: string
  vendor: string
  kind: "text" | "vision"
  usd_in: number
  usd_out: number
}

export interface ServerModels {
  models: OfferedModel[]
  /** null: the server has no key of its own; the rule-based engine answers. */
  serverDefault: { model: string; vision_model: string } | null
}

interface PresetsOut {
  data: { name: string; models?: OfferedModel[] }[]
  server_default: {
    provider: string
    model: string
    vision_model: string
  } | null
}

const SAMPLE: ServerModels = {
  models: [
    {
      id: "deepseek-ai/DeepSeek-V4-Flash-0731",
      label: "DeepSeek V4 Flash",
      vendor: "DeepSeek",
      kind: "text",
      usd_in: 0.14,
      usd_out: 0.28,
    },
    {
      id: "zai-org/GLM-5.3-Flash",
      label: "GLM-5.3 Flash",
      vendor: "Z.ai",
      kind: "vision",
      usd_in: 0.15,
      usd_out: 0.5,
    },
    {
      id: "moonshotai/Kimi-K2.6",
      label: "Kimi K2.6",
      vendor: "Moonshot AI",
      kind: "vision",
      usd_in: 0.95,
      usd_out: 4,
    },
  ],
  serverDefault: {
    model: "deepseek-ai/DeepSeek-V4-Flash-0731",
    vision_model: "zai-org/GLM-5.3-Flash",
  },
}

async function fetchServerModels(): Promise<ServerModels> {
  const out = await http.request<PresetsOut>("GET", "/ai/providers/presets")
  const nebius = out.data.find((p) => p.name === "nebius")
  return {
    models: nebius?.models ?? [],
    serverDefault: out.server_default
      ? {
          model: out.server_default.model,
          vision_model: out.server_default.vision_model,
        }
      : null,
  }
}

export function useServerModels() {
  return useQuery({
    queryKey: ["ai", "server-models"],
    queryFn: liveMode ? fetchServerModels : async () => SAMPLE,
    staleTime: 60 * 60 * 1000,
  })
}

/** "$0.14 / $0.28 per 1M tokens" */
const usd = (n: number) => `$${n.toFixed(Math.round(n * 1000) % 10 ? 3 : 2)}`
export const priceText = (m: OfferedModel) =>
  `${usd(m.usd_in)} / ${usd(m.usd_out)} per 1M tokens`
