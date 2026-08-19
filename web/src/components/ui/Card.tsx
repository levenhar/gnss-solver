import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { springSmooth } from "./transitions";

export function Card({ className = "", delay = 0, ...props }: HTMLMotionProps<"div"> & { delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`material-panel rounded-2xl border border-hair shadow-elevated ${className}`}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springSmooth, delay }}
      {...props}
    />
  );
}
