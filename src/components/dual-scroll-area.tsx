"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

type Props = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Applied to the main (content) scroller — e.g. maxHeight */
  mainStyle?: CSSProperties;
  mainClassName?: string;
};

/**
 * Horizontal scrollbar at the top AND bottom, kept in sync —
 * so wide tables can be scrolled from the header without jumping to the footer.
 */
export function DualScrollArea({ children, className, style, mainStyle, mainClassName }: Props) {
  const topRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const syncSpacerWidth = useCallback(() => {
    const main = mainRef.current;
    const spacer = spacerRef.current;
    if (!main || !spacer) return;
    const width = Math.max(main.scrollWidth, main.clientWidth);
    spacer.style.width = `${width}px`;
  }, []);

  useLayoutEffect(() => {
    syncSpacerWidth();
  });

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    syncSpacerWidth();
    const ro = new ResizeObserver(() => syncSpacerWidth());
    ro.observe(main);
    const table = main.querySelector("table");
    if (table) ro.observe(table);

    window.addEventListener("resize", syncSpacerWidth);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncSpacerWidth);
    };
  }, [syncSpacerWidth, children]);

  function onTopScroll() {
    if (syncing.current || !topRef.current || !mainRef.current) return;
    syncing.current = true;
    mainRef.current.scrollLeft = topRef.current.scrollLeft;
    syncing.current = false;
  }

  function onMainScroll() {
    if (syncing.current || !topRef.current || !mainRef.current) return;
    syncing.current = true;
    topRef.current.scrollLeft = mainRef.current.scrollLeft;
    syncing.current = false;
  }

  return (
    <div className={["dual-scroll", className].filter(Boolean).join(" ")} style={style}>
      <div
        ref={topRef}
        className="dual-scroll-top"
        onScroll={onTopScroll}
        aria-hidden="true"
      >
        <div ref={spacerRef} className="dual-scroll-spacer" />
      </div>
      <div
        ref={mainRef}
        className={["dual-scroll-main", mainClassName].filter(Boolean).join(" ")}
        style={mainStyle}
        onScroll={onMainScroll}
      >
        {children}
      </div>
    </div>
  );
}
