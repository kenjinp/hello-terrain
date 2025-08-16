import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="flex flex-1 flex-col justify-center text-center">
      <h1 className="mb-4 text-2xl font-bold">About Hello Terrain</h1>
      <p className="text-fd-muted-foreground">
        This is a simple placeholder About page. More details coming soon.
      </p>
      <p className="text-fd-muted-foreground">
        Visit{" "}
        <Link
          href="/docs"
          className="text-fd-foreground font-semibold underline"
        >
          /docs
        </Link>{" "}
        to learn more.
      </p>
    </main>
  );
}
