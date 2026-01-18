import { Logo } from "@/components/Logo/Logo";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center text-center px-4">
      <div className="flex flex-col items-center justify-center gap-2">
        <div className="flex justify-center items-center">
          <Logo size="lg" />
        </div>
        <h1 className="text-2xl font-bold">Hello Terrain</h1>
        <p className=" mb-4">Realtime web terrain engine, for vast virtual worlds.</p>
        <div className="flex flex-row flex-wrap items-center justify-center gap-2 mb-4">
          <Link href="https://threejs.org/docs/" target="_blank" rel="noopener noreferrer">
            <img
              src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white"
              alt="Three.js"
            />
          </Link>
          <Link
            href="https://docs.pmnd.rs/react-three-fiber"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/badge/React--Three--Fiber-000000?style=for-the-badge&logo=react&logoColor=61DAFB"
              alt="react-three-fiber"
            />
          </Link>
          <Link href="https://threejs.org/docs/" target="_blank" rel="noopener noreferrer">
            <img
              src="https://img.shields.io/badge/WebGPU-F34B7D?style=for-the-badge&logo=webgpu&logoColor=white&colorA=000000&colorB=000000"
              alt="WebGPU"
            />
          </Link>
          <Link
            href="https://www.npmjs.com/package/@hello-terrain/three"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/npm/v/@hello-terrain/three?style=for-the-badge&colorA=000000&colorB=000000"
              alt="npm version"
            />
          </Link>
        </div>
        <p className="text-fd-muted-foreground">
          You can open{" "}
          <Link href="/docs" className="text-fd-foreground font-semibold underline">
            /docs
          </Link>{" "}
          to see the documentation.
        </p>
        <p className="text-fd-muted-foreground">
          Check out the{" "}
          <Link href="/examples" className="text-fd-foreground font-semibold underline">
            /examples
          </Link>{" "}
          to see some examples.
        </p>
      </div>
    </main>
  );
}
