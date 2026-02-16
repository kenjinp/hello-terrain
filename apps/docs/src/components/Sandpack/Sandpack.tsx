"use client";

import {
  Sandpack as SandpackRoot,
  type SandpackFiles,
  type SandpackPredefinedTemplate,
} from "@codesandbox/sandpack-react";
import { useEffect, useState } from "react";

interface SandpackProps {
  /** The Sandpack template to use (e.g. "react", "react-ts", "vanilla", "vanilla-ts") */
  template?: SandpackPredefinedTemplate;
  /** Files to include in the sandbox */
  files?: SandpackFiles;
  /** Dependencies to add to the sandbox */
  dependencies?: Record<string, string>;
  /** Whether to show the file explorer panel */
  showFileExplorer?: boolean;
  /** Whether the code editor is read-only */
  readOnly?: boolean;
  /** Which panels to show: "preview", "console", or both */
  showConsole?: boolean;
  /** Whether to show line numbers in the editor */
  showLineNumbers?: boolean;
  /** Editor height in pixels */
  editorHeight?: number;
  /** The file to open by default (e.g. "/App.tsx") */
  activeFile?: string;
  /** Additional class name for the container */
  className?: string;
}

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));

    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function Sandpack({
  template = "react",
  files,
  dependencies,
  showFileExplorer = false,
  readOnly = false,
  showConsole = false,
  showLineNumbers = true,
  editorHeight = 350,
  activeFile,
  className,
}: SandpackProps) {
  const isDark = useIsDarkMode();

  return (
    <div className={`not-prose my-6 [&_.sp-wrapper]:rounded-lg! ${className ?? ""}`}>
      <SandpackRoot
        template={template}
        theme={isDark ? "dark" : "light"}
        files={files}
        customSetup={dependencies ? { dependencies } : undefined}
        options={{
          showLineNumbers,
          editorHeight,
          showConsole,
          readOnly,
          activeFile: activeFile ?? undefined,
          ...(showFileExplorer ? { showNavigator: true } : {}),
        }}
      />
    </div>
  );
}
