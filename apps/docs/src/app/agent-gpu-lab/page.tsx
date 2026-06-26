import { GpuAgentLab } from "@/components/GpuAgentLab/GpuAgentLab";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GPU Agent Lab | Hello Terrain",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AgentGpuLabPage() {
  return <GpuAgentLab />;
}
