import Image from "next/image";
import { brandLogo } from "@/lib/branding";

export function BrandLogo({
  name = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel",
  size = 148,
  decorative = false,
  className,
}: {
  name?: string;
  size?: number;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={brandLogo}
      sizes={`${size}px`}
      alt={decorative ? "" : `${name} logo`}
      className={`brand-logo${className ? ` ${className}` : ""}`}
      style={{ width: size, height: "auto" }}
    />
  );
}

export function Brand({ name, size }: { name?: string; size?: number }) {
  return (
    <div className="brand">
      <BrandLogo name={name} size={size} />
      <small className="brand-tagline">TELECOM WORKSPACE</small>
    </div>
  );
}
