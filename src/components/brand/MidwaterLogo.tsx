import logo from '@/assets/midwater-logo.png.asset.json';

interface Props {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}

export function MidwaterLogo({ className = '', showWordmark = false, size = 32 }: Props) {
  const pad = Math.max(2, Math.round(size * 0.1));
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span
        className="inline-flex items-center justify-center rounded-md shrink-0 bg-[hsl(220_25%_5%)] ring-1 ring-border/40"
        style={{ width: size, height: size, padding: pad }}
      >
        <img
          src={logo.url}
          alt="Midwater"
          width={size - pad * 2}
          height={size - pad * 2}
          className="object-contain"
          style={{ width: size - pad * 2, height: size - pad * 2 }}
        />
      </span>
      {showWordmark && (
        <span className="text-lg font-bold tracking-tight text-foreground">
          MID<span className="text-primary">WATER</span>
        </span>
      )}
    </div>
  );
}
