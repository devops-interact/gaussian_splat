import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35c889]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "bg-[#35c889]/15 text-[#35c889] border border-[#35c889]/20 hover:bg-[#35c889]/25 hover:border-[#35c889]/30 active:bg-[#35c889]/30 shadow-md hover:shadow-lg shadow-[#35c889]/5",
                destructive: "bg-red-500/12 text-red-400 border border-red-500/15 hover:bg-red-500/20 hover:border-red-500/25 active:bg-red-500/25 shadow-md hover:shadow-lg",
                outline: "border border-white/[0.08] bg-transparent text-gray-300 hover:bg-[#081717] hover:text-white hover:border-white/[0.12]",
                secondary: "bg-[#081717] text-gray-300 border border-white/[0.06] hover:bg-[#0c1f1f] hover:text-white",
                ghost: "text-gray-400 hover:bg-[#081717] hover:text-white",
                link: "text-[#35c889] underline-offset-4 hover:underline hover:text-[#35c889]/80",
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
