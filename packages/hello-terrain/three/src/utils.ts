export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

export const lerp = (a: number, b: number, t: number): number => {
  return a + (b - a) * t;
};

export const randomRange = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export const distanceToVector3 = (a: Vector3Like, b: Vector3Like): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};