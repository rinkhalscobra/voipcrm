"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Dialog, DialogContent } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { ErrorBanner, SubmitButton } from "./shared";
export interface Field {
  name: string;
  label: string;
  type?:
    "text" | "email" | "password" | "number" | "select" | "date" | "checkbox";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
  min?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
}
export interface Action {
  title: string;
  description: string;
  endpoint: string;
  method?: string;
  fields: Field[];
  submit?: string;
  transform?: (data: Record<string, string>) => unknown;
  links?: { href: string; label: string }[];
}
export function ActionDialog({
  action,
  close,
  notify,
}: {
  action: Action | null;
  close: () => void;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const [requestKey] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: (data: unknown) =>
      api(action!.endpoint, { method: action?.method ?? "POST", data }),
    onSuccess: async () => {
      await client.invalidateQueries();
      notify("Changes saved successfully.");
      close();
    },
  });
  return (
    <Dialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      {action && (
        <DialogContent title={action.title} description={action.description}>
          {action.links && (
            <div
              className="heading-actions"
              style={{ flexWrap: "wrap", marginBottom: 18 }}
            >
              {action.links.map((link) => (
                <Button key={link.href} size="sm" variant="outline" asChild>
                  <Link href={link.href} onClick={close}>
                    {link.label}
                  </Link>
                </Button>
              ))}
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const values = Object.fromEntries(
                new FormData(event.currentTarget).entries(),
              ) as Record<string, string>;
              values.idempotency_key = requestKey;
              mutation.mutate(
                action.transform
                  ? action.transform(values)
                  : Object.fromEntries(
                      action.fields.map((f) => [f.name, values[f.name] ?? ""]),
                    ),
              );
            }}
          >
            {mutation.error && <ErrorBanner error={mutation.error} />}
            <div className="form-grid">
              {action.fields.map((field) => (
                <label className="form-field" key={field.name}>
                  {field.label}
                  {field.type === "select" ? (
                    <Select
                      aria-label={field.label}
                      name={field.name}
                      required={field.required !== false}
                      defaultValue={field.defaultValue ?? ""}
                      options={[
                        ...(field.required === false
                          ? [{ value: "", label: "None" }]
                          : []),
                        ...(field.options ?? []),
                      ]}
                    />
                  ) : (
                    <Input
                      autoComplete={
                        field.type === "password" ? "new-password" : "off"
                      }
                      name={field.name}
                      type={field.type ?? "text"}
                      required={field.required !== false}
                      placeholder={field.placeholder}
                      defaultValue={field.defaultValue}
                      min={field.min}
                      step={field.step}
                      minLength={field.minLength}
                      maxLength={field.maxLength}
                    />
                  )}{" "}
                  {field.hint && (
                    <span className="form-hint">{field.hint}</span>
                  )}
                </label>
              ))}
            </div>
            <div className="form-actions">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={close}
              >
                Cancel
              </Button>
              <SubmitButton pending={mutation.isPending}>
                {action.submit ?? "Save changes"}
              </SubmitButton>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
