import * as THREE from 'three';

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function damp(current, target, lambda, dt) {
  // Exponential smoothing.
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function yawPitchToDir(yaw, pitch, out = new THREE.Vector3()) {
  // yaw around Y, pitch around X.
  // IMPORTANT: Match Three.js camera forward direction.
  // In Three.js, a camera with yaw=0 looks towards -Z.
  const cp = Math.cos(pitch);
  out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  return out.normalize();
}

