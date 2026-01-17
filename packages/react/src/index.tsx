// Library entry point
export function MyMesh({ color = "orange" }: { color?: string }) {
  return (
    <mesh>
      <boxGeometry />
      <meshStandardMaterial color={color} />
    </mesh>
  )
}