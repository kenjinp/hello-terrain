import type { Metadata } from "next";
import { GymLab } from "@/components/Gym/GymLab";

export const metadata: Metadata = {
  title: "Validation Gym",
  description:
    "Scenario-driven correctness harness: behavioral invariants over real WebGPU terrain runs, watchable and automatable.",
};

export default function GymPage() {
  return <GymLab />;
}
