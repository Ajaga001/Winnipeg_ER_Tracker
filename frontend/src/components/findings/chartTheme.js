// frontend/src/components/findings/chartTheme.js
// Colours and axis styling shared by the Findings charts. The series colours were
// checked for colour-blind separation against the dark card surface, in this order.

export const SERIES_COLOURS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];

export const AXIS_TICK = { fill: "#94a3b8", fontSize: 11 };
export const GRID_COLOUR = "#334155";
export const CURSOR_FILL = { fill: "#ffffff0d" };

// Every wait axis runs to the 15-hour cap, so charts can be compared at a glance.
export const WAIT_AXIS = {
  domain: [0, 900],
  ticks: [0, 300, 600, 900],
  tickFormatter: (minutes) => `${minutes / 60}h`,
};
