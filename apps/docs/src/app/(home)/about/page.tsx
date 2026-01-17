import Link from "next/link";
import { Mail } from "lucide-react";

// Bluesky icon - not available in lucide-react (brand icon)
const BlueskyIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 568 501"
    fill="currentColor"
  >
    <path d="M123.121 33.6637C188.241 82.5526 258.281 181.681 284 234.873C309.719 181.681 379.759 82.5526 444.879 33.6637C491.866 -1.61183 568 -28.9064 568 57.9464C568 75.2916 558.055 203.659 552.222 224.501C531.947 296.954 458.067 315.434 392.347 304.249C507.222 323.8 536.444 388.56 473.333 453.32C353.473 576.312 301.061 422.461 287.631 383.039C285.169 373.779 284.017 369.2 284 369.889C283.983 369.2 282.831 373.779 280.369 383.039C266.939 422.461 214.527 576.312 94.6667 453.32C31.5556 388.56 60.7778 323.8 175.653 304.249C109.933 315.434 36.0535 296.954 15.7778 224.501C9.94525 203.659 0 75.2916 0 57.9464C0 -28.9064 76.1345 -1.61183 123.121 33.6637Z" />
  </svg>
);

export default function AboutPage() {
  return (
    <main className="flex flex-1 flex-col justify-center px-4 py-12 max-w-3xl mx-auto">
      <div className="space-y-8">
        {/* Hero */}
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold">About this project</h1>
        </div>

        {/* Mission */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Why Hello Terrain?</h2>
          <p className="text-fd-muted-foreground leading-relaxed">
            I made this library to provide a simple framework for rendering
            large terrains so you can focus on the artful parts, like procedural
            generation, terrain painting, or experimentation.
          </p>
        </section>

        {/* Learning Journey */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">A Learning Journey</h2>
          <p className="text-fd-muted-foreground leading-relaxed">
            This project is my personal exploration of the world of ...
            rendering worlds. Terrain rendering is full of fascinating
            algorithms and techniques, so Hello Terrain is as much about
            learning and documenting these concepts as it is about providing
            useful tools.
          </p>
          <p className="text-fd-muted-foreground leading-relaxed">
            Expect explorations into topics like:
          </p>
          <ul className="list-disc list-inside text-fd-muted-foreground space-y-1 ml-2">
            <li>Procedural heightmap generation</li>
            <li>Terrain erosion simulation (thermal, hydraulic...)</li>
            <li>Level of detail (LOD) and chunking strategies</li>
            <li>WebGPU compute shaders</li>
            <li>Biome and texture splatting techniques</li>
          </ul>
        </section>

        {/* Teaching */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Learn With Me</h2>
          <p className="text-fd-muted-foreground leading-relaxed">
            One of my goals with Hello Terrain is to make procedural terrain
            generation more accessible. The documentation aims to not just show
            you <em>how</em> to use the library, but explain <em>why</em> things
            work the way they do. If you&apos;ve ever wanted to understand
            terrain erosion or procedural generation, I hope this project helps.
          </p>
        </section>

        {/* Get in Touch */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Get in Touch</h2>
          <p className="text-fd-muted-foreground leading-relaxed">
            Have questions, ideas, or want to collaborate? I&apos;d love to hear
            from you!
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <Link
              href="mailto:hello-terrain@kenny.wtf"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-fd-primary text-fd-primary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              <Mail size={18} />
              hello-terrain@kenny.wtf
            </Link>
            <Link
              href="https://bsky.app/profile/kenny.wtf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-fd-border font-medium hover:bg-fd-accent transition-colors"
            >
              <BlueskyIcon size={18} />
              @kenny.wtf on Bluesky
            </Link>
          </div>
        </section>

        {/* CTA */}
        <div className="text-center pt-4 space-y-4">
          <div className="h-px bg-fd-border" />
          <p className="text-fd-muted-foreground">
            Ready to make some virtual worlds?
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/docs"
              className="px-6 py-2 rounded-lg bg-fd-secondary text-fd-secondary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              Read the Docs
            </Link>
            <Link
              href="/examples"
              className="px-6 py-2 rounded-lg border border-fd-border font-medium hover:bg-fd-accent transition-colors"
            >
              View Examples
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
