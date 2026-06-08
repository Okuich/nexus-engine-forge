import logo from '@/assets/midwater-logo.png.asset.json';

interface Props {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}

export function MidwaterLogo({ className = '', showWordmark = false, size = 32 }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={logo.url}
        alt="Midwater"
        width={size}
        height={size}
        className="rounded-md shrink-0"
        style={{ width: size, height: size }}
      />
      {showWordmark && (
        <span className="text-lg font-bold tracking-tight text-foreground">
          MID<span className="text-primary">WATER</span>
        </span>
      )}
    </div>
  );
}
