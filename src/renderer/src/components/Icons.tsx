interface P {
  size?: number
}

const base = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

export const Play = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M7 4.5v15l12-7.5z" />
  </svg>
)

export const Pause = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <rect x="6.5" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="13.5" y="4.5" width="4" height="15" rx="1.2" />
  </svg>
)

export const Volume = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" fill="currentColor" stroke="none" />
    <path d="M15.8 9a4 4 0 0 1 0 6" />
    <path d="M18.4 6.6a7.5 7.5 0 0 1 0 10.8" />
  </svg>
)

export const VolumeOff = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" fill="currentColor" stroke="none" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </svg>
)

export const Live = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    <path d="M6.8 17.2a7.5 7.5 0 0 1 0-10.4M17.2 6.8a7.5 7.5 0 0 1 0 10.4" />
  </svg>
)

export const Gauge = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="M12 18l4-5" />
  </svg>
)

export const ChatBubble = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z" />
  </svg>
)

export const Layers = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 3.5l8 4.5-8 4.5-8-4.5z" />
    <path d="M4 13l8 4.5 8-4.5" />
  </svg>
)

export const Satellite = ({ size = 22 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 20a9 9 0 0 1 9-9M4 20a15 15 0 0 1 15-15" />
    <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const Alert = ({ size = 22 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5M12 16.3v.2" />
  </svg>
)

export const ChatOff = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z" />
    <path d="M3.5 3.5l17 17" />
  </svg>
)

export const Power = ({ size = 14 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 4.5v7" />
    <path d="M7.5 7a6.5 6.5 0 1 0 9 0" />
  </svg>
)

export const Star = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.9-3.8 5.4-.8z" />
  </svg>
)

export const StarOn = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)} fill="currentColor">
    <path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.9-3.8 5.4-.8z" />
  </svg>
)

export const Rail = ({ size = 16 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M10 5v14" />
  </svg>
)

export const ChevronLeft = ({ size = 14 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M14.5 6l-6 6 6 6" />
  </svg>
)

export const ChevronRight = ({ size = 14 }: P): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
)
