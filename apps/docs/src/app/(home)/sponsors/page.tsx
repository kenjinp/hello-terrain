import Link from "next/link";

export default function SponsorsPage() {
  return (
    <main className="flex flex-1 flex-col justify-center text-center">
      <h1 className="mb-4 text-2xl font-bold">Sponsors</h1>
      <p className="text-fd-muted-foreground">
        This is a placeholder Sponsors page. Interested in supporting the
        project?
      </p>
      <p className="text-fd-muted-foreground">
        Learn more in the{" "}
        <Link
          href="/docs"
          className="text-fd-foreground font-semibold underline"
        >
          /docs
        </Link>
        .
      </p>
    </main>
  );
}
