import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "bg-white/10 text-white border border-white/20 hover:bg-white/15 hover:border-white/30 active:bg-white/20 shadow-md hover:shadow-lg shadow-white/5",
                destructive: "bg-red-500/12 text-red-400 border border-red-500/19 hover:bg-red-500/20 hover:border-red-500/25 active:bg-red-500/25 shadow-md hover:shadow-lg",
                outline: "border border-white/15 bg-transparent text-neutral-300 hover:bg-white/5 hover:text-white hover:border-white/25",
                secondary: "bg-neutral-900 text-neutral-300 border border-white/10 hover:bg-white/8 hover:text-white",
                ghost: "text-neutral-400 hover:bg-white/5 hover:text-white",
                link: "text-white underline-offset-4 hover:underline hover:text-neutral-300",
            },
            size: {
                default: "h-11 px-6 py-3",
                sm: "h-9 px-4 py-2 text-xs",
                lg: "h-13 px-8 py-4 text-base",
                xl: "h-14 px-10 py-4 text-lg font-semibold",
                icon: "h-11 w-11",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
    loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                disabled={disabled || loading}
                {...props}
            >
                {loading ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                            />
                            <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                        </svg>
                        {children}
                    </>
                ) : (
                    children
                )}
            </Comp>
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
