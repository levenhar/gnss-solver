import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { springSnappy } from "./transitions";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accentInk hover:brightness-110 shadow-elevated",
  secondary: "border border-hair text-ink hover:border-hairStrong hover:bg-white/[0.04]",
  ghost: "text-muted hover:text-ink hover:bg-white/[0.04]",
};

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  disabled,
  ...props
}: Omit<HTMLMotionProps<"button">, "children"> & { variant?: Variant; busy?: boolean; children?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      whileTap={disabled || busy || reduce ? undefined : { scale: 0.97 }}
      transition={springSnappy}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium
        transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {busy && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />}
      {children}
    </motion.button>
  );
}
