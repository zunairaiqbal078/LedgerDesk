"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
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
  /** Horizontal scroll step when clicking arrows (px). Default ~ one column group. */
  arrowStep?: number;
};

/**
 * Horizontal scrollbar at the top AND bottom, kept in sync —
 * plus clickable ◀ ▶ arrows so wide tables can be panned without dragging.
 */
export function DualScrollArea({
  children,
  className,
  style,
  mainStyle,
  mainClassName,
  arrowStep = 720,
}: Props) {
  const topRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [needsArrows, setNeedsArrows] = useState(false);

  const syncSpacerWidth = useCallback(() => {
    const main = mainRef.current;
    const spacer = spacerRef.current;
    if (!main || !spacer) return;
    const width = Math.max(main.scrollWidth, main.clientWidth);
    spacer.style.width = `${width}px`;
  }, []);

  const updateArrowState = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    const max = main.scrollWidth - main.clientWidth;
    const overflow = max > 4;
    setNeedsArrows(overflow);
    setCanScrollLeft(overflow && main.scrollLeft > 2);
    setCanScrollRight(overflow && main.scrollLeft < max - 2);
  }, []);

  const scrollByX = useCallback((delta: number) => {
    const main = mainRef.current;
    const top = topRef.current;
    if (!main) return;
    const max = Math.max(0, main.scrollWidth - main.clientWidth);
    const next = Math.max(0, Math.min(main.scrollLeft + delta, max));
    // Instant jump — feels snappy for wide transaction tables
    main.scrollLeft = next;
    if (top) top.scrollLeft = next;
    updateArrowState();
  }, [updateArrowState]);

  useLayoutEffect(() => {
    syncSpacerWidth();
    updateArrowState();
  });

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    syncSpacerWidth();
    updateArrowState();
    const ro = new ResizeObserver(() => {
      syncSpacerWidth();
      updateArrowState();
    });
    ro.observe(main);
    const table = main.querySelector("table");
    if (table) ro.observe(table);

    window.addEventListener("resize", updateArrowState);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateArrowState);
    };
  }, [syncSpacerWidth, updateArrowState, children]);

  function onTopScroll() {
    if (syncing.current || !topRef.current || !mainRef.current) return;
    syncing.current = true;
    mainRef.current.scrollLeft = topRef.current.scrollLeft;
    syncing.current = false;
    updateArrowState();
  }

  function onMainScroll() {
    if (syncing.current || !topRef.current || !mainRef.current) return;
    syncing.current = true;
    topRef.current.scrollLeft = mainRef.current.scrollLeft;
    syncing.current = false;
    updateArrowState();
  }

  return (
    <div className={["dual-scroll", className].filter(Boolean).join(" ")} style={style}>
      <div className="dual-scroll-toolbar" aria-hidden={!needsArrows}>
        <button
          type="button"
          className="dual-scroll-arrow"
          disabled={!canScrollLeft}
          onClick={() => scrollByX(-arrowStep)}
          aria-label="Scroll table left"
          title="Scroll left"
        >
          ‹
        </button>
        <div
          ref={topRef}
          className="dual-scroll-top"
          onScroll={onTopScroll}
          aria-hidden="true"
        >
          <div ref={spacerRef} className="dual-scroll-spacer" />
        </div>
        <button
          type="button"
          className="dual-scroll-arrow"
          disabled={!canScrollRight}
          onClick={() => scrollByX(arrowStep)}
          aria-label="Scroll table right"
          title="Scroll right"
        >
          ›
        </button>
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
