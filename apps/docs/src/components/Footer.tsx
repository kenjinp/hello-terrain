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

const Footer = ({
  repositoryUrl = "https://github.com/kenjinp/hello-terrain",
  className = "",
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
    <footer
      className={`text-sm text-gray-500 border-t border-gray-200 py-4 ${className} text-foreground opacity-50`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row justify-between items-center space-y-2 sm:space-y-0">
          <div className="flex items-center space-x-4">
            <a
              href={githubCommitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              <span>Hello Terrain</span>
              <span>•</span>
              <span>Commit: {commitInfo.shortHash}</span>
              <span>•</span>
              <span>{formatDate(commitInfo.date)}</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
