import { cubeSphereProjection } from "../gpu/cubeSphere";
import { terrainGraph } from "./graph";
import { surfaceProjection } from "./params";

/** Creates the standard terrain graph with cube-sphere projection behavior. */
export function cubeSphereTerrainGraph() {
  const g = terrainGraph();
  g.set(surfaceProjection, () => cubeSphereProjection);
  return g;
}
