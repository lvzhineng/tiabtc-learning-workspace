import type { SVGProps } from 'react';

const ICON_COLOR = '#0f0f0f';

type IconProps = SVGProps<SVGSVGElement>;

function DrawingIcon({ children, ...props }: IconProps) {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: ICON_COLOR,
  strokeWidth: 1.25,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconTrendLine(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <line x1="6" y1="22" x2="22" y2="6" {...stroke} />
      <circle cx="6" cy="22" r="2" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.25" />
      <circle cx="22" cy="6" r="2" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.25" />
    </DrawingIcon>
  );
}

export function IconFibRetracement(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <line x1="5" y1="7" x2="23" y2="7" {...stroke} />
      <line x1="5" y1="12" x2="23" y2="12" {...stroke} />
      <line x1="5" y1="16" x2="23" y2="16" {...stroke} />
      <line x1="5" y1="21" x2="23" y2="21" {...stroke} />
      <circle cx="5" cy="7" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="23" cy="7" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="5" cy="21" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="23" cy="21" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconHalfRetracement(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <line x1="5" y1="7" x2="23" y2="7" {...stroke} />
      <line x1="5" y1="14" x2="23" y2="14" {...stroke} />
      <line x1="5" y1="21" x2="23" y2="21" {...stroke} />
      <text
        x="14"
        y="12"
        textAnchor="middle"
        fontSize="6"
        fontWeight="600"
        fill={ICON_COLOR}
      >
        0.5
      </text>
      <circle cx="5" cy="7" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="23" cy="7" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="5" cy="21" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="23" cy="21" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconShortPosition(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      {/* TradingView short: stop (red) above entry, target (green) below */}
      <rect x="7" y="5" width="14" height="9" fill="#ef5350" fillOpacity="0.28" />
      <rect x="7" y="14" width="14" height="9" fill="#26a69a" fillOpacity="0.28" />
      <rect x="7" y="5" width="14" height="18" rx="1" fill="none" {...stroke} />
      <line x1="7" y1="14" x2="21" y2="14" stroke={ICON_COLOR} strokeWidth="1.35" />
      <circle cx="7" cy="5" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="21" cy="5" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="7" cy="14" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="21" cy="14" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="7" cy="23" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="21" cy="23" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconLongPosition(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      {/* TradingView long: target (green) above entry, stop (red) below */}
      <rect x="7" y="5" width="14" height="9" fill="#26a69a" fillOpacity="0.28" />
      <rect x="7" y="14" width="14" height="9" fill="#ef5350" fillOpacity="0.28" />
      <rect x="7" y="5" width="14" height="18" rx="1" fill="none" {...stroke} />
      <line x1="7" y1="14" x2="21" y2="14" stroke={ICON_COLOR} strokeWidth="1.35" />
      <circle cx="7" cy="5" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="21" cy="5" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="7" cy="14" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="21" cy="14" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="7" cy="23" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="21" cy="23" r="1.4" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconDatePriceRange(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <rect x="6" y="7" width="16" height="14" rx="1" fill="#fff" {...stroke} />
      <circle cx="6" cy="7" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="22" cy="7" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="6" cy="21" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="22" cy="21" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconHorizontalRay(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <line x1="7" y1="14" x2="23" y2="14" {...stroke} />
      <circle cx="7" cy="14" r="2" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.25" />
    </DrawingIcon>
  );
}

export function IconParallelChannel(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <line x1="5" y1="18" x2="18" y2="6" {...stroke} />
      <line x1="10" y1="22" x2="23" y2="10" {...stroke} />
      <line x1="11.5" y1="12" x2="16.5" y2="16" {...stroke} strokeWidth={1} />
      <circle cx="5" cy="18" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="18" cy="6" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="10" cy="22" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="23" cy="10" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconRectangle(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <rect x="6" y="8" width="16" height="12" rx="1" fill="#fff" {...stroke} />
      <circle cx="6" cy="8" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="22" cy="8" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="6" cy="20" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="22" cy="20" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconText(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fontSize="16"
        fontFamily="IBM Plex Sans, Segoe UI, sans-serif"
        fontWeight="600"
        fill={ICON_COLOR}
      >
        T
      </text>
    </DrawingIcon>
  );
}

export function IconVolumeProfile(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <line x1="7" y1="5" x2="7" y2="23" {...stroke} />
      <line x1="7" y1="7" x2="20" y2="7" {...stroke} />
      <line x1="7" y1="11" x2="16" y2="11" {...stroke} />
      <line x1="7" y1="15" x2="22" y2="15" {...stroke} />
      <line x1="7" y1="19" x2="13" y2="19" {...stroke} />
    </DrawingIcon>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M14 6 L22 16 H17 V22 H11 V16 H6 Z" fill="#fff" {...stroke} />
    </DrawingIcon>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M14 22 L6 12 H11 V6 H17 V12 H22 Z" fill="#fff" {...stroke} />
    </DrawingIcon>
  );
}

export function IconBrush(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path
        d="M5 18 C8 10, 12 22, 15 12 C17 6, 20 10, 23 8"
        fill="none"
        {...stroke}
      />
      <circle cx="5" cy="18" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="23" cy="8" r="1.6" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconRotatedRectangle(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M9 7 L22 10 L19 21 L6 18 Z" fill="#fff" {...stroke} />
      <circle cx="9" cy="7" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="22" cy="10" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="19" cy="21" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
      <circle cx="6" cy="18" r="1.5" fill="#fff" stroke={ICON_COLOR} strokeWidth="1.1" />
    </DrawingIcon>
  );
}

export function IconSelect(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M8 5 L8 20 L12 16 L15 23 L17.2 22 L14.2 15 L20 15 Z" fill="#fff" {...stroke} />
    </DrawingIcon>
  );
}

export function IconMagnet(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path
        d="M9 7 V14 C9 17.3 11.2 20 14 20 C16.8 20 19 17.3 19 14 V7"
        fill="none"
        {...stroke}
      />
      <line x1="9" y1="7" x2="9" y2="11" {...stroke} />
      <line x1="19" y1="7" x2="19" y2="11" {...stroke} />
    </DrawingIcon>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M10 10 H7 V7" fill="none" {...stroke} />
      <path d="M7 10 C9 6, 19 5, 21 12 C22 17, 17 22, 12 21" fill="none" {...stroke} />
    </DrawingIcon>
  );
}

export function IconRedo(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M18 10 H21 V7" fill="none" {...stroke} />
      <path d="M21 10 C19 6, 9 5, 7 12 C6 17, 11 22, 16 21" fill="none" {...stroke} />
    </DrawingIcon>
  );
}

export function IconLock(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <rect x="8" y="12" width="12" height="9" rx="1.5" fill="#fff" {...stroke} />
      <path d="M10 12 V10 C10 7.8 11.8 6 14 6 C16.2 6 18 7.8 18 10 V12" fill="none" {...stroke} />
    </DrawingIcon>
  );
}

export function IconUnlock(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <rect x="8" y="12" width="12" height="9" rx="1.5" fill="#fff" {...stroke} />
      <path d="M10 12 V10 C10 7.8 11.8 6 14 6 C16.2 6 18 7.8 18 10" fill="none" {...stroke} />
    </DrawingIcon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M9 10 H19 V21 H9 Z" fill="#fff" {...stroke} />
      <line x1="7" y1="10" x2="21" y2="10" {...stroke} />
      <path d="M11 10 V8 H17 V10" fill="none" {...stroke} />
      <line x1="12" y1="13" x2="12" y2="18" {...stroke} />
      <line x1="16" y1="13" x2="16" y2="18" {...stroke} />
    </DrawingIcon>
  );
}

export function IconClear(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <path d="M8 18 C8 14, 12 12, 16 10 L19 13 C17 17, 14 20, 10 20 Z" fill="#fff" {...stroke} />
      <line x1="16" y1="10" x2="20" y2="6" {...stroke} />
    </DrawingIcon>
  );
}

export function IconPaperTrading(props: IconProps) {
  return (
    <DrawingIcon {...props}>
      <circle cx="14" cy="14" r="8" fill="#fff" {...stroke} />
      <circle cx="14" cy="14" r="2.5" fill={ICON_COLOR} />
    </DrawingIcon>
  );
}
