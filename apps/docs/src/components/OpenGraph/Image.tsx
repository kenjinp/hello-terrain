import type { PersistentImage } from "@takumi-rs/core";
import ImageResponse from "@takumi-rs/image-response";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReactNode } from "react";

const [
  latoRegular,
  latoBold,
  lisuBosaRegular,
  lisuBosaSemiBold,
  lisuBosaItalic,
  lisuBosaSemiBoldItalic,
] = await Promise.all([
  fetch("https://fonts.gstatic.com/s/lato/v25/S6uyw4BMUTPHjx4wXg.woff2").then((res) =>
    res.arrayBuffer(),
  ),
  fetch("https://fonts.gstatic.com/s/lato/v25/S6u9w4BMUTPHh6UVSwiPGQ.woff2").then((res) =>
    res.arrayBuffer(),
  ),
  fetch("https://fonts.gstatic.com/s/lisubosa/v2/3XFoErkv240fsdmJRJQfkEHj.woff2").then((res) =>
    res.arrayBuffer(),
  ),
  fetch("https://fonts.gstatic.com/s/lisubosa/v2/3XFtErkv240fsdmJRJQXT2X2QtzZ.woff2").then((res) =>
    res.arrayBuffer(),
  ),
  fetch("https://fonts.gstatic.com/s/lisubosa/v2/3XFuErkv240fsdmJRJQflXHhZfk.woff2").then((res) =>
    res.arrayBuffer(),
  ),
  fetch("https://fonts.gstatic.com/s/lisubosa/v2/3XFzErkv240fsdmJRJQflXk-Qezb_Pk.woff2").then(
    (res) => res.arrayBuffer(),
  ),
]);

export const fonts = [
  { name: "Lato", data: latoRegular, weight: 400 as const },
  { name: "Lato", data: latoBold, weight: 700 as const },
  { name: "Lisu Bosa", data: lisuBosaRegular, weight: 400 as const },
  { name: "Lisu Bosa", data: lisuBosaSemiBold, weight: 600 as const },
  { name: "Lisu Bosa", data: lisuBosaItalic, weight: 400 as const, style: "italic" as const },
  {
    name: "Lisu Bosa",
    data: lisuBosaSemiBoldItalic,
    weight: 600 as const,
    style: "italic" as const,
  },
];

const background = readFileSync(join(process.cwd(), "public/assets/og-background.png"));
const mountain = readFileSync(join(process.cwd(), "public/assets/snow-mountain.png"));

export const persistentImages: PersistentImage[] = [
  {
    src: "background",
    data: background,
  },
  {
    src: "mountain",
    data: mountain,
  },
];

export interface OGProps {
  title: ReactNode;
  description?: ReactNode;
}

export const OGImageResponse = ({ title, description }: OGProps) => {
  return new ImageResponse(<OgImage title={title} description={description} />, {
    persistentImages,
    fonts,
    width: 1200,
    height: 630,
    format: "webp",
  });
};

export function OgImage({ title, description }: OGProps) {
  return (
    <div
      style={{
        width: "1200px",
        height: "630px",
        position: "relative",
        backgroundColor: "#ffffff",
        overflow: "hidden",
      }}
    >
      {/* Background Layer */}
      <img
        src="background"
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "1200px",
          height: "630px",
          objectFit: "cover",
        }}
      />

      {/* Top-Left Speech Bubble Logo with Mountain */}
      <div
        style={{
          position: "absolute",
          top: "40px",
          left: "60px",
          width: "120px",
          height: "120px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <path
            d="M4 4c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H8.83L5.59 20.17A1 1 0 0 1 4 19.41V4z"
            fill="#6dd1ed"
            opacity="0.9"
          />
        </svg>
        <img
          src="mountain"
          alt=""
          style={{
            position: "absolute",
            top: "10px",
            width: "60px",
            height: "60px",
            objectFit: "contain",
          }}
        />
      </div>

      {/* Project Title (Small Header) - Now to the right of Logo */}
      <div
        style={{
          position: "absolute",
          top: "70px",
          left: "190px",
          fontFamily: "Lisu Bosa",
          fontSize: "32px",
          fontWeight: 600,
          fontStyle: "italic",
          color: "rgb(10, 10, 10)",
          opacity: 0.8,
          textShadow: "0px 2px 2px rgba(0,0,0,0.3)",
        }}
      >
        Hello Terrain
      </div>

      {/* Main Page Title */}
      <div
        style={{
          position: "absolute",
          top: "240px",
          left: 0,
          width: "1200px",
          display: "flex",
          justifyContent: "center",
          textAlign: "center",
          fontFamily: "Lisu Bosa",
          fontSize: "90px",
          fontWeight: 700,
          lineHeight: 1.1,
          color: "#000000",
          letterSpacing: "-0.04em",
          padding: "0 100px",
          textShadow: "0px 2px 2px rgba(0,0,0,0.7)",
        }}
      >
        {title}
      </div>

      {/* Description */}
      {description && (
        <div
          style={{
            position: "absolute",
            top: "380px",
            height: "500px",
            left: 0,
            width: "1200px",
            display: "flex",
            justifyContent: "center",
            textAlign: "center",
            fontFamily: "Lato",
            fontSize: "36px",
            fontWeight: 400,
            lineHeight: 1.4,
            color: "#333333",
            padding: "0 150px",
          }}
        >
          {description}
        </div>
      )}
    </div>
  );
}
