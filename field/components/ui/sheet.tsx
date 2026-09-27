'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

const sides = {
  right: 'inset-y-0 right-0 h-full w-full max-w-xl border-l',
  left: 'inset-y-0 left-0 h-full w-[300px] border-r',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] w-full border-t',
};

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: keyof typeof sides }
>(({ className, children, side = 'right', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/60" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('fixed z-50 flex flex-col overflow-y-auto border-structure bg-surface shadow-panel scroll-thin', sides[side], className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close aria-label="Close" className="absolute right-3 top-3 grid min-h-tap min-w-tap place-items-center border border-structure bg-surface text-ink hover:bg-structure hover:text-canvas">
        <X size={18} />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';
