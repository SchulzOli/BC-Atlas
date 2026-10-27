// The parallel turn on inline skates as a pure model. Everything the figure
// shows (the lean of both skates, the pendulum, the readout) comes from here.
//
// In a steady turn the skater leans until gravity and the centripetal pull
// add up to a line through the wheels: tan(lean) = v² / (g · r). Both skates
// lean by that same angle (that is what "parallel" means), so the outside skate
// rolls onto its inside edge and the inside skate onto its outside edge.

export const GRAVITY = 9.81;
export const SPEEDS = [6, 18];
export const RADII = [3, 5, 8];
export const LEAD_CM = 12;
export const STANCE_CM = 22.4;

export const metres = (kmh) => kmh / 3.6;

export function leanOf(kmh, radius) {
  const v = metres(kmh);
  return Math.atan((v * v) / (GRAVITY * radius));
}

export const degrees = (radians) => (radians * 180) / Math.PI;

export function readoutOf(kmh, radius, lean) {
  return `${kmh.toFixed(0)} km/h · r ${radius} m · lean ${degrees(lean).toFixed(0)}°`;
}
