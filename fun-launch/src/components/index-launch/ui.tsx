import type { ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Progress from '@radix-ui/react-progress';
import * as Tooltip from '@radix-ui/react-tooltip';

export function SectionTabs({
  value,
  onValueChange,
  items,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: string[];
  children: ReactNode;
}) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange}>
      <Tabs.List className="detail-tabs" aria-label="Index sections">
        {items.map((item) => (
          <Tabs.Trigger value={item} key={item}>
            {item}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value={value} className="tab-content">
        {children}
      </Tabs.Content>
    </Tabs.Root>
  );
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const progress = Math.min(
    100,
    Math.max(0, Number.isFinite(value) ? value : 0),
  );
  return (
    <Progress.Root
      className="progress-track"
      value={progress}
      aria-label={label}
    >
      <Progress.Indicator style={{ transform: `scaleX(${progress / 100})` }} />
    </Progress.Root>
  );
}

export function HelpTip({
  children,
  text,
}: {
  children: ReactNode;
  text: string;
}) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="lab-tooltip" sideOffset={8}>
            {text}
            <Tooltip.Arrow />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
