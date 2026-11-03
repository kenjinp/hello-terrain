"use client";

import TexturingScene from "./TexturingScene";

/** Native mipmapped BC3 arrays drive the terrain's public textureFn/material-node pipeline. */
export default function MaterialsBCNScene() {
  return <TexturingScene mode="bcn" />;
}
