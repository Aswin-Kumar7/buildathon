import { useEffect, useMemo, useRef } from 'react';

/**
 * Refracted sheets of light over a white ground, tinted by a colour map that slowly cycles.
 *
 * Modelled on the Razorpay sign-in field, which is not a static gradient: its whole palette walks a
 * blue → cyan → teal → mint ramp over about twelve seconds, and the panel's own copy shifts hue with
 * it. Both behaviours are here. The departure is the refraction — the sheets bend through a slow
 * standing wave and a gentle noise field instead of running dead straight, so the panel reads as
 * light through rippled glass rather than through a blind.
 *
 * Three families of sheets are stacked at rising frequency and falling weight: broad ones carry the
 * colour, fine ones carry the detail. That layering is what gives the field depth without letting it
 * dissolve into blobs — the structure stays legibly directional at every scale.
 *
 * The ground stays white and the tint only ever lands where a sheet is bright, which is what keeps
 * this quiet enough to sit behind a form.
 */

/** The ramp, as linear-ish RGB stops. Shared by the shader and by the accent colour below. */
const RAMP: readonly [number, number, number][] = [
  [0.663, 0.753, 1.0], // periwinkle
  [0.498, 0.816, 1.0], // sky
  [0.435, 0.902, 0.855], // aqua
  [0.588, 0.937, 0.706], // mint
];

export interface LightStreaksProps {
  /** Direction of the sheets, in degrees. */
  angle?: number;
  /** How strongly the tint shows against the white ground, 0..1. */
  intensity?: number;
  /** Seconds for one full trip around the colour ramp. */
  cycleSeconds?: number;
  className?: string;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_phase;
uniform float u_angle;
uniform float u_intensity;
uniform vec3 u_ramp[4];

out vec4 fragColor;

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/* Value noise with a smoothstep fade — cheap, and smooth enough to bend a coordinate with. */
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * vnoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/* One family of sheets. The sine gives evenly spaced bands; the power sharpens them into soft-
   edged sheets, so a low power reads as a broad wash and a high one as a thin filament of light. */
float sheet(float x, float freq, float phase, float sharp) {
  return pow(0.5 + 0.5 * sin(x * freq + phase), sharp);
}

/* Cyclic four-stop ramp, walked by both time and position along the sheets. */
vec3 rampColor(float x) {
  float s = fract(x) * 4.0;
  int i = int(floor(s));
  float f = smoothstep(0.0, 1.0, fract(s));
  if (i == 0) return mix(u_ramp[0], u_ramp[1], f);
  if (i == 1) return mix(u_ramp[1], u_ramp[2], f);
  if (i == 2) return mix(u_ramp[2], u_ramp[3], f);
  return mix(u_ramp[3], u_ramp[0], f);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 q = rot(p - vec2(0.5 * aspect, 0.5), u_angle);

  float t = u_time;

  /* The axis the sheets run across. Bending it is the whole trick: a clean standing wave gives the
     regular swell of rippled glass, and one octave-limited noise field breaks that regularity so the
     ripple never repeats visibly. Both are small next to q.x, which is what keeps the result a set
     of sheets rather than the shapeless blobs a full domain warp would produce. */
  float bend = sin(q.y * 2.3 + t * 0.17) * 0.048 + sin(q.y * 4.1 - t * 0.11) * 0.017;
  float organic = (fbm(q * 1.35 + vec2(0.0, t * 0.06)) - 0.5) * 0.20;
  float a = q.x + bend + organic;

  /* Three families at rising frequency and falling weight — broad sheets carry the colour, fine
     ones the detail. Each drifts at its own rate, so they slide across one another instead of
     travelling as a single rigid pattern. */
  float fan = 1.0 + 0.20 * sin(q.y * 1.1 + t * 0.08);
  float broad = sheet(a, 13.0 * fan, t * 0.30, 3.6);
  float mid = sheet(a, 24.0 * fan, -t * 0.22 + 1.3, 6.5);
  float fine = sheet(a, 41.0 * fan, t * 0.17 + 2.6, 9.0);
  float light = broad * 0.58 + mid * 0.27 + fine * 0.15;

  /* Colour walks the ramp in time and along the axis, so the panel spreads across the ramp at any
     one moment rather than being a single flat hue that changes. */
  vec3 tint = rampColor(u_phase + a * 0.34 + q.y * 0.10);

  float depth = smoothstep(0.30, 1.55, uv.x + uv.y * 0.62);

  vec3 col = vec3(1.0);
  col = mix(col, tint, clamp(light, 0.0, 1.0) * u_intensity * (0.52 + 0.62 * depth));

  /* The bright core of the mid family, sampled at three slightly different points on the axis so
     each channel creases in a different place. That is chromatic aberration, and it is what makes
     these read as light bent through glass rather than as painted stripes. */
  float ph = -t * 0.22 + 1.3;
  vec3 fringe = vec3(
    sheet(a + 0.0050, 24.0 * fan, ph, 26.0),
    sheet(a, 24.0 * fan, ph, 26.0),
    sheet(a - 0.0050, 24.0 * fan, ph, 26.0)
  );
  col += fringe * 0.44 * mix(vec3(1.0), tint, 0.35);

  /* A wide, very soft bloom so the panel has depth behind the sheets. */
  float bloom = smoothstep(0.15, 0.95, 1.0 - length(uv - vec2(0.34, 0.66)) * 1.15);
  col = mix(col, mix(col, tint, 0.15), bloom);

  /* The copy sits bottom-left, so the field is lifted back toward white underneath it — the text
     keeps its contrast without a scrim drawn over the artwork. */
  float clear = smoothstep(0.60, 0.02, uv.x + uv.y * 0.55);
  col = mix(col, mix(col, vec3(1.0), 0.55), clear);

  fragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

interface Scene {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  shaders: WebGLShader[];
  u: Record<string, WebGLUniformLocation | null>;
}

function setup(gl: WebGL2RenderingContext): Scene {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);

  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u: Scene['u'] = {};
  for (const name of ['u_resolution', 'u_time', 'u_phase', 'u_angle', 'u_intensity']) {
    u[name] = gl.getUniformLocation(program, name);
  }
  for (let i = 0; i < RAMP.length; i++) {
    u[`u_ramp[${i}]`] = gl.getUniformLocation(program, `u_ramp[${i}]`);
  }
  return { program, buffer, shaders: [vs, fs], u };
}

interface Settings {
  angle: number;
  intensity: number;
  cycleSeconds: number;
}

function useStreaks(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  hostRef: React.RefObject<HTMLDivElement | null>,
  s: Settings,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (canvas === null || host === null) return;

    // Absent under jsdom and without WebGL2; the panel then keeps its CSS background.
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (gl === null) return;

    const scene = setup(gl);
    const resize = (): void => {
      // Capped ratio: this is a full-bleed panel and 3x on a phone buys nothing visible. It stays
      // at 2x rather than lower because the fine sheets are thin and sharply powered, and thin
      // high-contrast detail is the first thing to alias when it is under-sampled.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(host.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(host.clientHeight * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const paint = (seconds: number): void => {
      const phase = seconds / s.cycleSeconds;
      gl.uniform2f(scene.u['u_resolution']!, canvas.width, canvas.height);
      gl.uniform1f(scene.u['u_time']!, seconds * 0.35);
      gl.uniform1f(scene.u['u_phase']!, phase);
      gl.uniform1f(scene.u['u_angle']!, (s.angle * Math.PI) / 180);
      gl.uniform1f(scene.u['u_intensity']!, s.intensity);
      for (let i = 0; i < RAMP.length; i++) {
        const c = RAMP[i]!;
        gl.uniform3f(scene.u[`u_ramp[${i}]`]!, c[0], c[1], c[2]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let frame = 0;

    if (still) {
      paint(0);
    } else {
      const tick = (now: number): void => {
        paint((now - start) / 1000);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      gl.deleteProgram(scene.program);
      for (const sh of scene.shaders) gl.deleteShader(sh);
      gl.deleteBuffer(scene.buffer);
    };
  }, [canvasRef, hostRef, s]);
}

export function LightStreaks({
  angle = 118,
  intensity = 0.66,
  cycleSeconds = 16,
  className,
}: LightStreaksProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const settings = useMemo<Settings>(
    () => ({ angle, intensity, cycleSeconds }),
    [angle, intensity, cycleSeconds],
  );
  useStreaks(canvasRef, hostRef, settings);

  return (
    <div ref={hostRef} className={className} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
