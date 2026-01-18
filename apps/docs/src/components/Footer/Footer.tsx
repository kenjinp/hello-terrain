import { GitInfo } from "@/components/GitInfo/GitInfo";
import Link from "fumadocs-core/link";

export const Footer = () => {
  return (
    <footer className="text-sm opacity-50 py-2 text-shadow-md text-center flex flex-row items-center justify-center gap-4 align-middle">
      <div>
        <Link href="https://kenny.wtf" external>
          authored by Kenneth Pirman
        </Link>
      </div>
      <div>
        <GitInfo />
      </div>
    </footer>
  );
};
