import { GlossaryListServer, GlossaryTerm } from "@/components/Glossary";
import { MdxImage } from "@/components/MdxImage";
import { FbmTerrainSandpack } from "@/components/Sandpack/FbmTerrainSandpack";
import { HeightmapTerrainSandpack } from "@/components/Sandpack/HeightmapTerrainSandpack";
import { Sandpack } from "@/components/Sandpack/Sandpack";
import { SinWaveTerrainSandpack } from "@/components/Sandpack/SinWaveTerrainSandpack";
import { TopologySandpackTabs } from "@/components/Sandpack/TopologySandpack";
import { Mermaid } from "fumadocs-mermaid/ui";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    img: MdxImage,
    MdxImage,
    Mermaid,
    GlossaryList: GlossaryListServer,
    GlossaryTerm,
    Sandpack,
    SinWaveTerrainSandpack,
    FbmTerrainSandpack,
    HeightmapTerrainSandpack,
    TopologySandpackTabs,
    ...components,
  };
}
