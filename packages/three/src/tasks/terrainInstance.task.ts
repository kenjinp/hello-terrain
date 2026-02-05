import { task } from "@hello-terrain/work";

export const terrainInstanceIdTask = task(() => crypto.randomUUID())
  .displayName("terrainInstanceIdTask")
  .cache("once");
