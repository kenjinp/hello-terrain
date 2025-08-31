import { GitInfo } from "@/components/GitInfo/GitInfo";
import Link from "fumadocs-core/link";

export const Footer = () => {
  return (
    <footer className="text-sm opacity-50 py-4 text-shadow-md text-center flex flex-row items-center justify-center gap-2">
      <div>
        Copyright © 2025{" "}
        <Link href="https://kenny.wtf" className="underline">
          Kenneth Pirman
        </Link>
        . All rights reserved
      </div>
      <div>
        <GitInfo />
      </div>
    </footer>
  );
};
