import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { springSmooth } from "./transitions";

export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const reduce = useReducedMotion();
  console.log("[PageTransition] render key=", location.pathname);

  return (
    <AnimatePresence
      mode="wait"
      initial={false}
      onExitComplete={() => console.log("[PageTransition] onExitComplete for", location.pathname)}
    >
      <motion.div
        key={location.pathname}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
        transition={springSmooth}
        onAnimationStart={() => console.log("[PageTransition] animation start", location.pathname)}
        onAnimationComplete={() => console.log("[PageTransition] animation complete", location.pathname)}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
