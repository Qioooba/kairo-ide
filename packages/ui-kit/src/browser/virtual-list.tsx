import * as React from 'react';

/**
 * Props for the VirtualList component.
 *
 * T is the item type. The component only renders items that are visible
 * in the viewport plus a small overscan buffer, keeping the DOM size
 * bounded regardless of the total item count.
 */
export interface VirtualListProps<T> {
  /** All items in the list. */
  items: readonly T[];
  /** Fixed row height in pixels. Default: 24 */
  rowHeight?: number;
  /** Total number of items (used when items is a window into a larger set). Defaults to items.length. */
  itemCount?: number;
  /** 0-based index of the currently selected item, or -1 for none. */
  selectedIndex?: number;
  /** Called when the user navigates to a different item. */
  onSelectIndex?: (index: number) => void;
  /**
   * Render a single item.
   * @param item The item to render.
   * @param index The absolute index of the item in the full list.
   * @param isSelected Whether this item is currently selected.
   */
  renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
  /**
   * Number of extra rows to render above and below the visible viewport.
   * Default: 5.
   */
  overscan?: number;
  /** CSS class name for the scrollable container. */
  className?: string;
  /** Additional keyboard handler called after internal navigation keys. */
  onKeyDown?: (event: React.KeyboardEvent) => void;
  /**
   * When set, the list will scroll to bring this index into view.
   * Resets to undefined after scrolling.
   */
  scrollToIndex?: number;
  /** Called when the user scrolls to the very bottom of the list. */
  onScrollToBottom?: () => void;
  /** Called on every scroll event with the current scroll info. */
  onScroll?: (scrollInfo: { scrollTop: number; scrollHeight: number; clientHeight: number }) => void;
  /** Enable keyboard navigation (ArrowUp/Down, PageUp/Down, Home/End). Default: true. */
  keyboardNavigation?: boolean;
  /** aria-label for the scrollable container. */
  ariaLabel?: string;
  /** data-testid for the scrollable container. */
  testId?: string;
  /** ARIA role for the scrollable container. Default: "listbox". */
  role?: string;
  /** aria-live value for the scrollable container. */
  ariaLive?: 'off' | 'polite' | 'assertive';
}

const DEFAULT_ROW_HEIGHT = 24;
const DEFAULT_OVERSCAN = 5;

/**
 * A generic virtual-scrolling list component.
 *
 * Only renders the rows that are visible in the viewport (plus a small
 * overscan buffer), so the DOM stays lightweight even with hundreds of
 * thousands of items.
 */
export function VirtualList<T>({
  items,
  rowHeight = DEFAULT_ROW_HEIGHT,
  itemCount,
  selectedIndex = -1,
  onSelectIndex,
  renderItem,
  overscan = DEFAULT_OVERSCAN,
  className,
  onKeyDown,
  scrollToIndex,
  onScrollToBottom,
  onScroll,
  keyboardNavigation = true,
  ariaLabel,
  testId,
  role = 'listbox',
  ariaLive,
}: VirtualListProps<T>): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [containerHeight, setContainerHeight] = React.useState(400);

  const totalCount = itemCount ?? items.length;

  // --- Track container size with ResizeObserver ---
  React.useEffect(() => {
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // --- Scroll handler ---
  const handleScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop: st, scrollHeight, clientHeight } = e.currentTarget;
      setScrollTop(st);
      // Detect scroll to bottom
      if (onScrollToBottom && st + clientHeight >= scrollHeight - 2) {
        onScrollToBottom();
      }
      onScroll?.({ scrollTop: st, scrollHeight, clientHeight });
    },
    [onScrollToBottom, onScroll],
  );

  // --- Scroll to index ---
  React.useEffect(() => {
    if (scrollToIndex === undefined || scrollToIndex < 0 || !containerRef.current) {
      return;
    }
    const container = containerRef.current;
    const itemTop = scrollToIndex * rowHeight;
    const itemBottom = itemTop + rowHeight;
    if (itemTop < container.scrollTop) {
      container.scrollTop = itemTop;
    } else if (itemBottom > container.scrollTop + containerHeight) {
      container.scrollTop = itemBottom - containerHeight;
    }
  }, [scrollToIndex, rowHeight, containerHeight]);

  // --- Calculate visible range ---
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(totalCount, startIndex + visibleCount);

  const visibleItems = items.slice(Math.max(0, startIndex), endIndex);

  const totalHeight = totalCount * rowHeight;

  // --- Keyboard navigation ---
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent): void => {
      if (!keyboardNavigation || totalCount === 0) {
        onKeyDown?.(event);
        return;
      }
      let newIndex = selectedIndex;
      let handled = true;
      switch (event.key) {
        case 'ArrowDown':
          newIndex = Math.min(selectedIndex + 1, totalCount - 1);
          break;
        case 'ArrowUp':
          newIndex = Math.max(selectedIndex - 1, 0);
          break;
        case 'PageDown':
          newIndex = Math.min(
            selectedIndex + Math.max(1, Math.floor(containerHeight / rowHeight)),
            totalCount - 1,
          );
          break;
        case 'PageUp':
          newIndex = Math.max(
            selectedIndex - Math.max(1, Math.floor(containerHeight / rowHeight)),
            0,
          );
          break;
        case 'Home':
          newIndex = 0;
          break;
        case 'End':
          newIndex = totalCount - 1;
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        if (newIndex !== selectedIndex) {
          onSelectIndex?.(newIndex);
        }
      }
      onKeyDown?.(event);
    },
    [keyboardNavigation, totalCount, selectedIndex, containerHeight, rowHeight, onSelectIndex, onKeyDown],
  );

  return (
    <div
      ref={containerRef}
      className={className}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onScroll={handleScroll}
      aria-label={ariaLabel}
      data-testid={testId}
      role={role}
      aria-live={ariaLive}
      aria-activedescendant={
        selectedIndex >= 0 && selectedIndex < totalCount
          ? `virtual-list-item-${selectedIndex}`
          : undefined
      }
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item, i) => {
          const absoluteIndex = startIndex + i;
          const top = absoluteIndex * rowHeight;
          const isSelected = absoluteIndex === selectedIndex;
          return (
            <div
              key={absoluteIndex}
              id={`virtual-list-item-${absoluteIndex}`}
              style={{
                position: 'absolute',
                top,
                height: rowHeight,
                left: 0,
                right: 0,
              }}
            >
              {renderItem(item, absoluteIndex, isSelected)}
            </div>
          );
        })}
      </div>
    </div>
  );
}