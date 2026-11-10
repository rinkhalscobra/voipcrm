"use client";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="standalone">
      <Brand />
      <h1>The workspace could not load</h1>
      <p>Your data has been preserved. Try loading this page again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
