export const homePages = {
  home: {
    title: "Hello Terrain",
    description: "Realtime web terrain engine, for vast virtual worlds.",
  },
  about: {
    title: "About",
    description: "What's all this then?!",
  },
  showcase: {
    title: "Showcase",
    description: "Projects and demos built with Hello Terrain.",
  },
  sponsors: {
    title: "Sponsors",
    description: "Support the Hello Terrain project.",
  },
} as const;

export type HomePageKey = keyof typeof homePages;

export function getHomePageImage(key: HomePageKey) {
  return `/og/${key}.webp`;
}
