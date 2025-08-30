import Link from "fumadocs-core/link";

// Extend ImportMeta interface for Vite environment variables
declare global {
  interface ImportMeta {
    env: {
      NEXT_PUBLIC_GIT_COMMIT_HASH?: string;
      NEXT_PUBLIC_GIT_COMMIT_DATE?: string;
    };
  }
}

interface CommitInfo {
  hash: string;
  date: string;
  shortHash: string;
}

interface FooterProps {
  repositoryUrl?: string;
  className?: string;
}

export const GitInfo = ({
  repositoryUrl = "https://github.com/kenjinp/hello-terrain",
}: FooterProps) => {
  // Get commit info from environment variables or build-time data
  const commitInfo: CommitInfo = {
    hash: process.env.NEXT_PUBLIC_GIT_COMMIT_HASH || "unknown",
    date: process.env.NEXT_PUBLIC_GIT_COMMIT_DATE || "unknown",
    shortHash: (process.env.NEXT_PUBLIC_GIT_COMMIT_HASH || "unknown").substring(
      0,
      7
    ),
  };

  const formatDate = (dateString: string) => {
    if (dateString === "unknown") return "unknown";
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const githubCommitUrl = `${repositoryUrl}/commit/${commitInfo.hash}`;

  return (
    <Link
      href={githubCommitUrl}
      className="flex justify-between items-center gap-2 text-sm py-2 px-4"
    >
      <span className="whitespace-nowrap">Hello Terrain</span>
      <span className="font-bold">{commitInfo.shortHash}</span>
      <span>{formatDate(commitInfo.date)}</span>
    </Link>
  );
};
