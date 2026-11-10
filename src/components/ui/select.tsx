"use client";

import { useId, useRef, useState, type ComponentProps } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type SelectProps = Omit<
  ComponentProps<typeof SelectPrimitive.Root>,
  "children"
> &
  Pick<
    ComponentProps<typeof SelectPrimitive.Trigger>,
    "id" | "aria-label" | "aria-labelledby" | "aria-describedby"
  > & {
    options: readonly SelectOption[];
    placeholder?: string;
    emptyMessage?: string;
    className?: string;
    size?: "form" | "compact";
  };

export function Select({
  options,
  placeholder = "Select an option",
  emptyMessage = "No options available",
  className,
  size = "form",
  id,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  value,
  defaultValue = "",
  onValueChange,
  ...props
}: SelectProps) {
  const [selection, setSelection] = useState(defaultValue);
  const [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const selected = value ?? selection;
  const selectedOption = options.find((option) => option.value === selected);
  const emptyOption = options.find((option) => option.value === "");

  return (
    <span
      className={cn("select-control", size === "form" && "select-full-width")}
      onInvalidCapture={(event) => {
        // The primitive's hidden form control keeps native required validation.
        // Put its error and focus on the visible control instead of browser UI.
        event.preventDefault();
        setInvalid(true);
        const control = event.target as HTMLSelectElement;
        const firstInvalid = control.form?.querySelector(
          "input:invalid,select:invalid,textarea:invalid",
        );
        if (!firstInvalid || firstInvalid === control) trigger.current?.focus();
      }}
    >
      <SelectPrimitive.Root
        {...props}
        value={selected}
        onValueChange={(next) => {
          setSelection(next);
          setInvalid(false);
          onValueChange?.(next);
        }}
      >
        <SelectPrimitive.Trigger
          ref={trigger}
          id={id}
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-describedby={
            [describedBy, invalid && errorId].filter(Boolean).join(" ") ||
            undefined
          }
          aria-invalid={invalid || undefined}
          data-empty-option={emptyOption ? "" : undefined}
          className={cn("select-trigger", `select-${size}`, className)}
        >
          <SelectPrimitive.Value
            placeholder={emptyOption?.label ?? placeholder}
          >
            {selectedOption?.label}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon className="select-chevron">
            <ChevronDown size={15} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="select-content"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <SelectPrimitive.ScrollUpButton className="select-scroll-button">
              <ChevronUp size={15} />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="select-viewport">
              {options.length ? (
                options.map((option) => (
                  <SelectPrimitive.Item
                    className="select-item"
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    textValue={option.label}
                  >
                    <SelectPrimitive.ItemText>
                      {option.label}
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="select-check">
                      <Check size={15} />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))
              ) : (
                <div className="select-empty">{emptyMessage}</div>
              )}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="select-scroll-button">
              <ChevronDown size={15} />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {invalid && (
        <span id={errorId} className="select-error" role="alert">
          Please select an option.
        </span>
      )}
    </span>
  );
}
