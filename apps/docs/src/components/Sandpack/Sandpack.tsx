"use client";

import {
  Sandpack as SandpackRoot,
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
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
  /** Whether to show the console panel */
  showConsole?: boolean;
  /** Whether to show line numbers in the editor */
  showLineNumbers?: boolean;
  /** Editor height in pixels */
  editorHeight?: number;
  /** The file to open by default (e.g. "/App.tsx") */
  activeFile?: string;
  /** Hide the preview panel and show only the code editor */
  codeOnly?: boolean;
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

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    setIsMobile(mql.matches);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

function SandpackRunButton() {
  const { sandpack } = useSandpack();
  const isRunning =
    sandpack.status === "running" || sandpack.status === "timeout";

  return (
    <button
      type="button"
      onClick={() => sandpack.runSandpack()}
      disabled={isRunning}
      className="sp-mobile-run-button absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-(--sp-colors-clickable) bg-(--sp-colors-surface1) px-4 py-2 text-sm font-medium text-(--sp-colors-clickable) shadow-sm transition hover:bg-(--sp-colors-surface2) disabled:opacity-50 md:hidden"
    >
      {isRunning ? "Running…" : "Run"}
    </button>
  );
}

type MobileTab = "preview" | "code";

function SandpackMobileLayout({
  template,
  theme,
  files,
  dependencies,
  showFileExplorer,
  showLineNumbers,
  readOnly,
  editorHeight,
  activeFile,
  className,
}: {
  template: SandpackProps["template"];
  theme: "light" | "dark";
  files: SandpackProps["files"];
  dependencies: SandpackProps["dependencies"];
  showFileExplorer: boolean;
  showLineNumbers: boolean;
  readOnly: boolean;
  editorHeight: number;
  activeFile: SandpackProps["activeFile"];
  className?: string;
}) {
  const [activeTab, setActiveTab] = useState<MobileTab>("preview");

  return (
    <div
      className={`not-prose my-6 [&_.sp-wrapper]:rounded-lg! ${className ?? ""}`}
    >
      <SandpackProvider
        template={template ?? "react"}
        theme={theme}
        files={files}
        customSetup={dependencies ? { dependencies } : undefined}
        options={{
          activeFile: activeFile ?? undefined,
          autorun: false,
        }}
      >
        {/* Tab bar: Preview (default) and Code */}
        <div className="flex border-b border-fd-border bg-fd-background md:hidden">
          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "preview"
                ? "border-b-2 border-fd-primary text-fd-foreground"
                : "text-fd-muted-foreground hover:text-fd-foreground"
            }`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("code")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "code"
                ? "border-b-2 border-fd-primary text-fd-foreground"
                : "text-fd-muted-foreground hover:text-fd-foreground"
            }`}
          >
            Code
          </button>
        </div>

        {/* Preview tab: same background as blog, centered Run button */}
        {activeTab === "preview" && (
          <div
            className="sp-mobile-preview-wrapper relative min-h-[200px] w-full bg-fd-background md:hidden"
            style={{ height: editorHeight }}
          >
            <SandpackPreview className="h-full min-h-0!" />
            <SandpackRunButton />
          </div>
        )}

        {/* Code tab: file explorer + editor */}
        {activeTab === "code" && (
          <SandpackLayout className="md:hidden">
            {showFileExplorer && <SandpackFileExplorer />}
            <SandpackCodeEditor
              showLineNumbers={showLineNumbers}
              showReadOnly={false}
              readOnly={readOnly}
              style={{ height: editorHeight }}
            />
          </SandpackLayout>
        )}
      </SandpackProvider>
    </div>
  );
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
  codeOnly = false,
  className,
}: SandpackProps) {
  const isDark = useIsDarkMode();
  const isMobile = useIsMobile();
  const theme = isDark ? "dark" : "light";

  if (codeOnly) {
    return (
      <div
        className={`not-prose my-6 [&_.sp-wrapper]:rounded-lg! ${className ?? ""}`}
      >
        <SandpackProvider
          template={template}
          theme={theme}
          files={files}
          customSetup={dependencies ? { dependencies } : undefined}
          options={{ activeFile: activeFile ?? undefined }}
        >
          <SandpackLayout>
            {showFileExplorer && <SandpackFileExplorer />}
            <SandpackCodeEditor
              showLineNumbers={showLineNumbers}
              showReadOnly={false}
              readOnly={readOnly}
              style={{ height: editorHeight }}
            />
          </SandpackLayout>
        </SandpackProvider>
      </div>
    );
  }

  // On mobile: no autorun, tabbed layout (Preview default, Code tab), Run button in preview
  if (isMobile) {
    return (
      <SandpackMobileLayout
        template={template}
        theme={theme}
        files={files}
        dependencies={dependencies}
        showFileExplorer={showFileExplorer}
        showLineNumbers={showLineNumbers}
        readOnly={readOnly}
        editorHeight={editorHeight}
        activeFile={activeFile}
        className={className}
      />
    );
  }

  return (
    <div
      className={`not-prose my-6 [&_.sp-wrapper]:rounded-lg! ${className ?? ""}`}
    >
      <SandpackRoot
        template={template}
        theme={theme}
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
