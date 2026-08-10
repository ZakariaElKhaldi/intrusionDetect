import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type TabValue = string | number;

export interface TabOption<Value extends TabValue> {
  label: string;
  value: Value;
}

interface TabListProps<Value extends TabValue> {
  baseId: string;
  label: string;
  options: readonly TabOption<Value>[];
  panelId: string;
  selected: Value;
  onSelect: (value: Value) => void;
  className?: string;
}

export function tabId(baseId: string, value: TabValue) {
  return `${baseId}-${String(value)}-tab`;
}

export function TabList<Value extends TabValue>({
  baseId,
  label,
  options,
  panelId,
  selected,
  onSelect,
  className = "stage-tabs",
}: TabListProps<Value>) {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selected));
  const [focusIndex, setFocusIndex] = useState(selectedIndex);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setFocusIndex(selectedIndex);
  }, [selectedIndex]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % options.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    setFocusIndex(nextIndex);
    tabs.current[nextIndex]?.focus();
  };

  return (
    <div className={className} role="tablist" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => { tabs.current[index] = element; }}
          id={tabId(baseId, option.value)}
          type="button"
          role="tab"
          aria-controls={panelId}
          aria-selected={option.value === selected}
          tabIndex={index === focusIndex ? 0 : -1}
          onClick={() => {
            setFocusIndex(index);
            onSelect(option.value);
          }}
          onKeyDown={(event) => moveFocus(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
