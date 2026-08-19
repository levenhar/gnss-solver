import type { Transition } from "framer-motion";

// Critically damped default — settle without overshoot (apple-design: damping 1.0).
export const springSmooth: Transition = { type: "spring", bounce: 0, duration: 0.35 };

// Reserved for momentum-driven interactions only (a flick/drag release), not passive UI.
export const springMomentum: Transition = { type: "spring", bounce: 0.2, duration: 0.4 };

export const springSnappy: Transition = { type: "spring", bounce: 0, duration: 0.22 };
