import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/50" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 left-0 z-50 w-[280px] border-r border-structure bg-surface p-4 shadow-panel',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 border border-structure p-1 text-ink hover:bg-structure hover:text-canvas">
        <X size={14} />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';
