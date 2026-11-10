import Link from "next/link";
import { Brand } from "@/components/brand";
export default function NotFound() {
  return (
    <div className="standalone">
      <Brand />
      <span className="eyebrow">404 · PAGE NOT FOUND</span>
      <h1>This route is unavailable.</h1>
      <Link href="/">Return to your workspace →</Link>
    </div>
  );
}
