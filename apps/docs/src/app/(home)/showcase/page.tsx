import Link from "next/link";

export default function ShowcasePage() {
  return (
    <main className="flex flex-1 flex-col justify-center text-center gap-2">
      <h1 className="mb-4 text-2xl font-bold">Showcase</h1>
      <p className="text-fd-muted-foreground">
        Projects and demos built with Hello Terrain.
      </p>
      <Link
        href="mailto:hello-terrain@kenny.wtf"
        className="text-fd-foreground font-semibold underline"
      >
        Add your project here!{" "}
      </Link>
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
