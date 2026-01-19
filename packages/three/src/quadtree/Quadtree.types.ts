import { type Quadtree } from "./Quadtree";

/**
 * A simple 3D vector interface to avoid Three.js dependency in some cases.
 * Compatible with THREE.Vector3 and any object with x, y, z properties.
 */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuadtreeParams {
  maxLevel: number;
  rootSize: number;
  minNodeSize: number;
  origin: Vector3Like;
  maxNodes: number;
}

export type ShouldSubdivideContext = [
  quadtree: Quadtree,
  distance: number,
  level: number,
  nodeSize: number,
  minNodeSize: number,
  rootSize: number,
  nodeX: number,
  nodeY: number,
  minX: number,
  minY: number,
  worldX: number,
  worldY: number,
];

/**
 * Function type for subdivision strategies.
 * Returns true if the node should be subdivided, false otherwise.
 */
export type SubdivisionStrategy = (...context: ShouldSubdivideContext) => boolean;
