import Link from "next/link";

export default function ShowcasePage() {
  return (
    <main className="flex flex-1 flex-col justify-center text-center">
      <h1 className="mb-4 text-2xl font-bold">Showcase</h1>
      <p className="text-fd-muted-foreground">
        Placeholder for projects and demos built with Hello Terrain.
      </p>
      <p className="text-fd-muted-foreground">
        Explore examples at{" "}
        <Link
          href="/examples"
          className="text-fd-foreground font-semibold underline"
        >
          /examples
        </Link>
        .
      </p>
    </main>
  );
}
