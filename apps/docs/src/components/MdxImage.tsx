"use client";

import type { ImgHTMLAttributes } from "react";
import Zoom from "react-medium-image-zoom";

/** MDX image with click-to-zoom lightbox. Use for JSX `<MdxImage />` and markdown images via `img`. */
export function MdxImage({
  src,
  alt = "",
  className,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement>) {
  if (!src) return null;

  return (
    <Zoom zoomMargin={24} wrapElement="span">
      {/* Native img avoids Next Image width/height requirements for public assets. */}
      <img
        src={src}
        alt={alt}
        className={className ? `${className} cursor-zoom-in` : "cursor-zoom-in"}
        {...rest}
      />
    </Zoom>
  );
}
