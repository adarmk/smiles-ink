import { useEffect } from "react";

/**
 * Mirror the visual viewport into CSS variables so the docks stay above the
 * mobile on-screen keyboard.
 */
export function useVisualViewportVars() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let animationFrame = 0;
    const syncVisualViewport = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        root.style.setProperty(
          "--visual-viewport-height",
          `${viewport?.height ?? window.innerHeight}px`,
        );
        root.style.setProperty(
          "--visual-viewport-offset-top",
          `${viewport?.offsetTop ?? 0}px`,
        );
      });
    };

    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("scroll", syncVisualViewport);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("scroll", syncVisualViewport);
    };
  }, []);
}
