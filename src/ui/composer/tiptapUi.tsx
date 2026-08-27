/*
 * Adapted from Tiptap UI Components at
 * https://github.com/ueberdosis/tiptap-ui-components/tree/799929bea4804c73767562b69f8acc2acdb8ac86
 * under the MIT license in ./tiptap-ui.LICENSE.
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import React from 'react';

type EditorButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  danger?: boolean;
  iconOnly?: boolean;
};

type EditorSeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  decorative?: boolean;
  orientation?: 'horizontal' | 'vertical';
};

export const EditorButton = React.forwardRef<HTMLButtonElement, EditorButtonProps>(
  ({ active, children, className = '', danger, iconOnly, onMouseDown, onPointerDown, ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      aria-pressed={active === undefined ? props['aria-pressed'] : active}
      className={`tiptap-button${danger ? ' danger' : ''}${
        iconOnly ? ' icon-only' : ''
      }${className ? ` ${className}` : ''}`}
      data-active-state={active ? 'on' : 'off'}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        if (!event.defaultPrevented) event.preventDefault();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented && event.pointerType === 'mouse') event.preventDefault();
      }}
    >
      {children}
    </button>
  )
);
EditorButton.displayName = 'EditorButton';

export const EditorInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input {...props} ref={ref} className={`tiptap-input${className ? ` ${className}` : ''}`} />
  )
);
EditorInput.displayName = 'EditorInput';

export const EditorCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => (
    <div {...props} ref={ref} className={`tiptap-card${className ? ` ${className}` : ''}`} />
  )
);
EditorCard.displayName = 'EditorCard';

export const EditorCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => (
    <div {...props} ref={ref} className={`tiptap-card-header${className ? ` ${className}` : ''}`} />
  )
);
EditorCardHeader.displayName = 'EditorCardHeader';

export const EditorCardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => (
    <div {...props} ref={ref} className={`tiptap-card-body${className ? ` ${className}` : ''}`} />
  )
);
EditorCardBody.displayName = 'EditorCardBody';

export const EditorSeparator = React.forwardRef<HTMLDivElement, EditorSeparatorProps>(
  ({ className = '', decorative, orientation = 'vertical', ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      aria-orientation={!decorative && orientation === 'vertical' ? 'vertical' : undefined}
      className={`tiptap-separator${className ? ` ${className}` : ''}`}
      data-orientation={orientation}
      role={decorative ? 'none' : 'separator'}
    />
  )
);
EditorSeparator.displayName = 'EditorSeparator';

export function EditorToolbar({
  'aria-label': ariaLabel,
  children,
  className = ''
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-label={ariaLabel} className={`tiptap-toolbar${className ? ` ${className}` : ''}`} role="toolbar">
      {children}
    </div>
  );
}

export function EditorDropdown({
  children,
  label,
  onCloseAutoFocus,
  portal = true,
  trigger
}: {
  children: React.ReactNode;
  label: string;
  onCloseAutoFocus?: () => void;
  portal?: boolean;
  trigger: React.ReactElement;
}) {
  const content = (
    <PopoverPrimitive.Content
      align="start"
      aria-label={label}
      className="tiptap-card tiptap-dropdown-menu"
      collisionPadding={8}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onCloseAutoFocus?.();
      }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)'
          )
        ];
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : event.key === 'ArrowDown'
                ? (current + 1 + items.length) % items.length
                : (current - 1 + items.length) % items.length;
        items[next]?.focus();
        event.preventDefault();
      }}
      role="menu"
      sideOffset={6}
    >
      {children}
    </PopoverPrimitive.Content>
  );
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      {portal ? <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal> : content}
    </PopoverPrimitive.Root>
  );
}

export function EditorDropdownRadioGroup({ children }: { children: React.ReactNode }) {
  return <div role="group">{children}</div>;
}

export function EditorDropdownRadioItem({
  checked,
  children,
  label,
  onSelect
}: {
  checked: boolean;
  children: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <PopoverPrimitive.Close asChild>
      <button
        aria-checked={checked}
        aria-label={label}
        className="tiptap-dropdown-item"
        role="menuitemradio"
        type="button"
        onClick={onSelect}
      >
        <span>{children}</span>
        {checked ? (
          <svg aria-hidden="true" className="tiptap-dropdown-indicator" fill="none" viewBox="0 0 24 24">
            <path d="m5 12 4 4L19 6" />
          </svg>
        ) : null}
      </button>
    </PopoverPrimitive.Close>
  );
}

export function EditorDropdownCheckboxItem({
  checked,
  children,
  label,
  onSelect
}: {
  checked: boolean;
  children: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="tiptap-dropdown-item"
      role="menuitemcheckbox"
      type="button"
      onClick={onSelect}
    >
      <span>{children}</span>
      {checked ? (
        <svg aria-hidden="true" className="tiptap-dropdown-indicator" fill="none" viewBox="0 0 24 24">
          <path d="m5 12 4 4L19 6" />
        </svg>
      ) : null}
    </button>
  );
}

export function EditorDropdownItem({
  children,
  danger,
  disabled,
  label,
  onSelect
}: {
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <PopoverPrimitive.Close asChild>
      <button
        aria-label={label}
        className={`tiptap-dropdown-item${danger ? ' danger' : ''}`}
        disabled={disabled}
        role="menuitem"
        type="button"
        onClick={onSelect}
      >
        {children}
      </button>
    </PopoverPrimitive.Close>
  );
}

export function EditorLinkPopover({
  getInitialHref,
  onApply,
  onCloseAutoFocus,
  onRemove,
  trigger
}: {
  getInitialHref: () => string;
  onApply: (href: string) => void;
  onCloseAutoFocus?: () => void;
  onRemove?: () => void;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  const [href, setHref] = React.useState('https://');
  const [error, setError] = React.useState('');
  const errorId = React.useId();

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setHref(getInitialHref());
          setError('');
        }
        setOpen(next);
      }}
    >
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          aria-label="链接设置"
          className="tiptap-card tiptap-link-popover"
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseAutoFocus?.();
          }}
          sideOffset={6}
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const value = href.trim();
              if (!/^https?:\/\/\S+$/i.test(value)) {
                setError('请输入完整的 http/https 链接');
                return;
              }
              onApply(value);
              setOpen(false);
            }}
          >
            <label className="tiptap-link-field">
              链接地址
              <EditorInput
                aria-describedby={error ? errorId : undefined}
                aria-invalid={Boolean(error)}
                aria-label="链接地址"
                autoCapitalize="none"
                inputMode="url"
                spellCheck={false}
                type="url"
                value={href}
                onChange={(event) => {
                  setHref(event.target.value);
                  if (error) setError('');
                }}
              />
            </label>
            {error ? (
              <p className="error" id={errorId} role="alert">
                {error}
              </p>
            ) : null}
            <div className="tiptap-link-actions">
              <EditorButton aria-label="应用链接" className="primary" type="submit">
                应用
              </EditorButton>
              {onRemove ? (
                <EditorButton
                  aria-label="移除链接"
                  danger
                  type="button"
                  onClick={() => {
                    onRemove();
                    setOpen(false);
                  }}
                >
                  移除
                </EditorButton>
              ) : null}
            </div>
          </form>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
