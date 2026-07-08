import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coffee-500 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-coffee-700 text-white hover:bg-coffee-800",
        secondary: "bg-coffee-100 text-coffee-900 hover:bg-coffee-200",
        outline: "border border-coffee-300 bg-white text-coffee-900 hover:bg-coffee-50",
        ghost: "text-coffee-800 hover:bg-coffee-100",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        success: "bg-green-700 text-white hover:bg-green-800",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 px-3 text-sm",
        lg: "h-14 px-6 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
