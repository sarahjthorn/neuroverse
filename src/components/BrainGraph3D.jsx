import { useEffect, useRef } from 'react'
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import SpriteText from 'three-spritetext'
import { forceX, forceY, forceZ } from 'd3-force-3d'
import { getCategoryColor, CATEGORY_ORDER, nodeCategoryList, categoryBridgeRgb } from '../utils/categories'
import { getGraphTheme } from '../themes'
import './BrainGraph3D.css'

// The Explore view: a No Man's Sky-style star map of the brain. Structure
// (nodes/edges) and presentation (what's visible, glowing, hovered,
// selected) are deliberately split - graphData is only rebuilt when the
// actual memories change, while everything else mutates the existing
// three.js objects in place, so scrubbing the timeline or hovering never
// restarts the force layout and makes the whole map jump.

// The canvas is always a black starfield regardless of the app theme, so
// edges always use the dark theme's treatment.
const DARK_GRAPH_THEME = getGraphTheme('dark')
const LIGHT_GRAPH_THEME = getGraphTheme('light')

// Two looks share all the behaviour below:
// - galaxy: the app's Explore view - black space, bloom, nebulae, labels.
// - paper: for embedding on a light page (the portfolio background) -
//   transparent canvas, no bloom/galaxy/fog, flat inked dots and hairlines.
const LOOKS = {
  galaxy: { transparent: false, bloom: true, galaxy: true, regionLabels: true, glowBlending: THREE.AdditiveBlending, glowStrength: 1, nodeScale: 1, background: '#000005', light: false },
  // Light-theme universe: a bright No Man's Sky-style sky - an indigo ->
  // pink -> peach gradient dome with teal/magenta nebula swirls - rather
  // than white paper. It's mid-toned, so white stars, comets and additive
  // glows still read, and a gentle, high-threshold bloom only catches them.
  galaxyLight: { transparent: false, bloom: true, bloomStrength: 0.35, bloomThreshold: 0.82, galaxy: true, regionLabels: true, glowBlending: THREE.AdditiveBlending, glowStrength: 0.8, nodeScale: 1, background: '#b86fd0', light: true, sky: true },
  paper: { transparent: true, bloom: false, galaxy: false, regionLabels: false, glowBlending: THREE.NormalBlending, glowStrength: 0.2, nodeScale: 0.55, light: true }
}

// Colours can be overridden per embed (e.g. the portfolio's riso inks).
// Anonymous memories (a public snapshot's private ones) never show their
// category colour - that would leak what they're about.
const DEFAULT_PALETTE = {
  categoryColor: getCategoryColor,
  anonymousColor: '#9a9ab4',
  linkRgb: null // null = the usual per-category bridge tint
}

const MAX_STRIPES = 6
const BIRTH_MS = 900
const AUTOROTATE_RESUME_MS = 10000
const FOCUS_DISTANCE = 260
// Zoom-out limit = this many times the brain's radius (never below
// MIN_MAX_DISTANCE), so the universe grows as memories are added. The
// galaxy backdrop is built for GALAXY_BASE_DISTANCE and scaled to match.
const MAX_DISTANCE_PER_RADIUS = 3.2
const MIN_MAX_DISTANCE = 700
const GALAXY_BASE_DISTANCE = 900
const WARMUP_TICKS = 250
const COOLDOWN_TICKS = 150
// Each memory keeps its strongest few links on screen by default; the rest
// only appear when you hover/select one of their ends (or they connect two
// search matches). A link survives if it's in the top N of EITHER end, so
// every connected memory keeps at least one visible link.
const BACKBONE_LINKS_PER_NODE = 4
// Screen-space width (px) of the glowing lines drawn for the focused star.
const FOCUS_LINE_WIDTH = 2.4

// Star positions survive the component unmounting (switching to Home and
// back), so the map is the same map every time you open Explore rather
// than a fresh random layout - and camera moves don't have to wait for the
// simulation to settle again.
const positionCache = new Map()
// Only a cache written by a finished simulation can be restored as-is; one
// saved mid-layout (leaving Explore early, or React dev mode's double mount)
// still seeds positions but lets the simulation keep running.
let positionCacheSettled = false
// Camera requests are nonces held in App state - remember which ones were
// already handled so remounting Explore doesn't replay an old fly-to.
let lastFocusNonce = null
let lastRecenterNonce = 0
let lastCometFocusNonce = null

// Size says "how connected": steep enough that a hub with 50 links is ~10x
// the radius of a loner, rather than the gentle sqrt curve it used to be.
function nodeRadius(degree) {
  return 2.2 + 1.35 * Math.pow(degree, 0.72)
}

// Labels only show for hovered/selected/search-matched stars, but even then
// a long memory title can dominate the view - cap it like the NMS
// reference's system names.
const LABEL_MAX_CHARS = 24
function truncateTitle(title) {
  if (!title || title.length <= LABEL_MAX_CHARS) return title || ''
  return `${title.slice(0, LABEL_MAX_CHARS - 1)}…`
}

// --- Category regions -------------------------------------------------------
// Each category gets a "home" point on a sphere that its memories drift
// toward. Categories that often appear together (on the same memory, or on
// either end of an edge) attract each other on that sphere, so e.g. Health
// and Interests end up as neighbouring regions rather than wherever a fixed
// ordering happened to put them - and multi-category memories, which sit
// between their homes, don't get stretched across the whole map.
const CATEGORY_HOME_RADIUS = 260
const REGION_LABEL_MIN_STARS = 3

function fibonacciSphere(count, radius) {
  return Array.from({ length: count }, (_, i) => {
    const offset = 2 / count
    const y = i * offset - 1 + offset / 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const phi = i * Math.PI * (3 - Math.sqrt(5))
    return new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).multiplyScalar(radius)
  })
}

function categoryAffinity(nodes, edges, nodesById) {
  const weights = new Map()
  const bump = (a, b, w) => {
    if (a === b) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    weights.set(key, (weights.get(key) || 0) + w)
  }
  nodes.forEach(n => {
    const cats = nodeCategoryList(n.data)
    for (let i = 0; i < cats.length; i++) {
      for (let j = i + 1; j < cats.length; j++) bump(cats[i], cats[j], 2)
    }
  })
  edges.forEach(e => {
    const a = nodesById.get(e.source)
    const b = nodesById.get(e.target)
    if (!a || !b) return
    nodeCategoryList(a.data).forEach(ca => nodeCategoryList(b.data).forEach(cb => bump(ca, cb, 1)))
  })
  return weights
}

function layoutCategoryHomes(presentCategories, weights) {
  const cats = CATEGORY_ORDER.filter(c => presentCategories.has(c))
  const points = fibonacciSphere(cats.length, CATEGORY_HOME_RADIUS)
  if (cats.length < 3) return new Map(cats.map((c, i) => [c, points[i]]))

  const maxWeight = Math.max(1, ...weights.values())
  const delta = new THREE.Vector3()
  for (let step = 0; step < 300; step++) {
    const forces = points.map(() => new THREE.Vector3())
    for (let i = 0; i < cats.length; i++) {
      for (let j = i + 1; j < cats.length; j++) {
        delta.subVectors(points[j], points[i])
        const dist = Math.max(delta.length(), 1)
        delta.divideScalar(dist)
        const key = cats[i] < cats[j] ? `${cats[i]}|${cats[j]}` : `${cats[j]}|${cats[i]}`
        const attraction = ((weights.get(key) || 0) / maxWeight) * dist * 0.02
        const repulsion = 25000 / (dist * dist)
        const f = attraction - repulsion
        forces[i].addScaledVector(delta, f)
        forces[j].addScaledVector(delta, -f)
      }
    }
    points.forEach((p, i) => p.add(forces[i]).setLength(CATEGORY_HOME_RADIUS))
  }
  return new Map(cats.map((c, i) => [c, points[i]]))
}

// --- Star objects ------------------------------------------------------------
let glowTextureCache = null
function getGlowTexture() {
  if (glowTextureCache) return glowTextureCache
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.6)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  glowTextureCache = new THREE.CanvasTexture(canvas)
  return glowTextureCache
}

// --- Galaxy background ----------------------------------------------------
// Three layers so the void doesn't feel flat: far twinkling stars, a few
// soft nebula clouds, and - closer in, around the brain itself - sparse
// coloured "synapse" lights that fire now and then. None of them take fog
// (they're meant to read as distant), and all share one time uniform.
const galaxyTime = { value: 0 }

const POINTS_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uSharpness;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (600.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    float wave = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
    vAlpha = pow(wave, uSharpness);
    vColor = aColor;
  }
`
const POINTS_FRAGMENT = /* glsl */ `
  uniform float uMinAlpha;
  uniform float uMaxAlpha;
  uniform float uGlint;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float soft = smoothstep(0.5, 0.0, d);
    // Glints: a small core plus four thin rays (the sparkle in a photo).
    if (uGlint > 0.5) {
      float core = smoothstep(0.12, 0.0, d);
      float rays = max(smoothstep(0.035, 0.0, abs(c.x)), smoothstep(0.035, 0.0, abs(c.y))) * smoothstep(0.5, 0.0, d);
      soft = max(core, rays);
    }
    gl_FragColor = vec4(vColor, soft * mix(uMinAlpha, uMaxAlpha, vAlpha));
    #include <colorspace_fragment>
  }
`

function randomInShell(minR, maxR) {
  const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
  return dir.multiplyScalar(minR + Math.random() * (maxR - minR))
}

function buildTwinklePoints({ count, minR, maxR, size, colors, speed, sharpness, minAlpha, maxAlpha, blending = THREE.AdditiveBlending, glint = false }) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const speeds = new Float32Array(count)
  const tints = new Float32Array(count * 3)
  const palette = colors.map(c => new THREE.Color(c))
  for (let i = 0; i < count; i++) {
    const p = randomInShell(minR, maxR)
    positions.set([p.x, p.y, p.z], i * 3)
    sizes[i] = size[0] + Math.random() * (size[1] - size[0])
    phases[i] = Math.random() * Math.PI * 2
    speeds[i] = speed[0] + Math.random() * (speed[1] - speed[0])
    const c = palette[Math.floor(Math.random() * palette.length)]
    tints.set([c.r, c.g, c.b], i * 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(tints, 3))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: galaxyTime,
      uSharpness: { value: sharpness },
      uMinAlpha: { value: minAlpha },
      uMaxAlpha: { value: maxAlpha },
      uGlint: { value: glint ? 1 : 0 }
    },
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending
  })
  return new THREE.Points(geometry, material)
}

// A soft, lumpy cloud: lots of overlapping faint radial blobs on a canvas.
function makeNebulaTexture(seedColor) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const color = new THREE.Color(seedColor)
  const rgb = `${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)}`
  for (let i = 0; i < 70; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * size * 0.2
    const x = size / 2 + Math.cos(angle) * dist
    const y = size / 2 + Math.sin(angle) * dist
    const r = size * (0.1 + Math.random() * 0.2)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${rgb},0.07)`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  // Fade everything out well before the texture's edge so the sprite's
  // square outline can never show.
  ctx.globalCompositeOperation = 'destination-in'
  const mask = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  mask.addColorStop(0, 'rgba(0,0,0,1)')
  mask.addColorStop(0.55, 'rgba(0,0,0,0.6)')
  mask.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = mask
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const NEBULA_COLORS = ['#5b3fd6', '#2b6cd4', '#1aa3a3', '#b03a9e', '#3d2a8f', '#6a2fa0']

// Light theme's sky: a huge inside-out sphere painted by a shader - a
// vertical indigo -> violet -> pink -> peach gradient, warped by noise so
// the bands aren't ruler-straight, with domain-warped teal/magenta nebula
// clouds and pale wisps drifting over it.
const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uUpper;
  uniform vec3 uMid;
  uniform vec3 uLower;
  uniform vec3 uBottom;
  uniform vec3 uTeal;
  uniform vec3 uMagenta;
  uniform vec3 uWisp;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float drift = uTime * 0.004;

    // Stretched so a level view spans most of it, not just the pink middle.
    float t = clamp(d.y * 1.1 + 0.5 + (fbm(d * 2.0 + drift) - 0.5) * 0.35, 0.0, 1.0);
    vec3 col = mix(uBottom, uLower, smoothstep(0.0, 0.32, t));
    col = mix(col, uMid, smoothstep(0.28, 0.5, t));
    col = mix(col, uUpper, smoothstep(0.5, 0.74, t));
    col = mix(col, uTop, smoothstep(0.72, 1.0, t));

    // Big soft colour fields, then streaky wisps on top (the domain warp
    // stretches the noise into filaments rather than round puffs).
    float teal = smoothstep(0.48, 0.72, fbm(d * 1.5 + vec3(11.0, 3.0, drift)));
    // Teal only up in the blue/violet half - over pink it mixes to grey.
    col = mix(col, uTeal, teal * 0.7 * smoothstep(0.45, 0.8, t));
    float magenta = smoothstep(0.52, 0.76, fbm(d * 1.7 + vec3(-7.0, drift, 4.0)));
    col = mix(col, uMagenta, magenta * 0.45 * smoothstep(0.2, 0.6, t));

    vec3 q = d * 3.0;
    vec3 warp = vec3(fbm(q + vec3(0.0, 0.0, drift)), fbm(q + vec3(5.2, 1.3, 2.8)), fbm(q + vec3(2.1, 7.7, 4.4)));
    float wisp = fbm(q * 1.3 + warp * 3.0);
    col = mix(col, uWisp, smoothstep(0.52, 0.82, wisp) * 0.5);

    // A touch of dither so the smooth gradient doesn't band.
    col += (hash(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function buildSkyDome() {
  const c = (hex) => ({ value: new THREE.Color(hex) })
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(4200, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        uTop: c('#2a2fb8'),
        uUpper: c('#7a4fd8'),
        uMid: c('#e070c8'),
        uLower: c('#ff92b8'),
        uBottom: c('#ffc78f'),
        uTeal: c('#2fc7c9'),
        uMagenta: c('#c22fb0'),
        uWisp: c('#fbe6ff'),
        uTime: galaxyTime
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false
    })
  )
  dome.renderOrder = -1
  return dome
}

function buildGalaxy(light) {
  const group = new THREE.Group()

  if (light) group.add(buildSkyDome())

  // Distant stars - many, tiny, gentle twinkle. White and gold on both
  // skies (the light one is mid-toned, so additive white still shows).
  group.add(buildTwinklePoints({
    count: light ? 3400 : 2600, minR: 2200, maxR: 3600, size: light ? [24, 56] : [1.6, 4],
    colors: light ? ['#ffffff', '#fff4d6', '#ffe9a8', '#e8f4ff'] : ['#ffffff', '#dfe6ff', '#fff2dc', '#cfd8ff'],
    speed: [0.4, 1.6], sharpness: 1, minAlpha: light ? 0.35 : 0.25, maxAlpha: 0.9
  }))

  // Synapse lights - sparse, coloured, closer, and mostly dark with a
  // sharp occasional flash (high sharpness = short bright peaks).
  group.add(buildTwinklePoints({
    count: 260, minR: 450, maxR: 1100, size: light ? [5, 9] : [2.5, 5],
    colors: light ? ['#ffffff', '#fff1b8', '#b8fff4', '#ffd0ec'] : ['#8875ff', '#4dabf7', '#22d3ee', '#f783ac', '#51cf66', '#ffd43b'],
    speed: [0.3, 1.1], sharpness: 10, minAlpha: 0.0, maxAlpha: 0.95
  }))

  if (light) {
    // A few four-pointed glints, like the sparkles in a nebula photo.
    group.add(buildTwinklePoints({
      count: 90, minR: 1600, maxR: 3400, size: [200, 360],
      colors: ['#ffffff', '#fff6dc'],
      speed: [0.2, 0.7], sharpness: 2, minAlpha: 0.25, maxAlpha: 1, glint: true
    }))
    // The dome paints the nebulae itself.
    return group
  }

  NEBULA_COLORS.forEach((color, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNebulaTexture(color),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    }))
    // Far enough out that even at the maximum zoom-out (see updateBounds)
    // the camera never gets close enough to see a cloud's texture.
    const p = randomInShell(3200, 3800)
    sprite.position.copy(p)
    const scale = 2200 + Math.random() * 1600
    sprite.scale.set(scale, scale * (0.6 + Math.random() * 0.5), 1)
    sprite.material.rotation = (i / NEBULA_COLORS.length) * Math.PI * 2
    group.add(sprite)
  })

  return group
}

// Striped "beach ball" planet: one longitudinal band per category, with a
// short blended seam between bands (same idea as the 2D node's conic
// gradient) plus a soft rim light so it still reads as a sphere under bloom.
const STRIPE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const STRIPE_FRAGMENT = /* glsl */ `
  uniform vec3 uColors[${MAX_STRIPES}];
  uniform int uCount;
  uniform float uOpacity;
  uniform float uBoost;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float n = float(uCount);
    float seg = vUv.x * n;
    int idx = int(floor(seg));
    int next = int(mod(floor(seg) + 1.0, n));
    float seam = smoothstep(0.82, 1.0, fract(seg));
    vec3 col = mix(uColors[idx], uColors[next], seam);
    float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.0);
    col = col * (0.9 + uBoost * 0.6) + col * rim * 0.4;
    gl_FragColor = vec4(col, uOpacity);
    // Convert to the output colour space like built-in materials do (a
    // no-op when rendering into the bloom composer's linear target, but
    // without it the light theme showed raw linear, over-saturated colours).
    #include <colorspace_fragment>
  }
`

function makeStarObject(node, palette, look) {
  const colors = node.anonymous || node.categories.length === 0
    ? [new THREE.Color(palette.anonymousColor)]
    : node.categories.slice(0, MAX_STRIPES).map(c => new THREE.Color(palette.categoryColor(c)))
  const r = nodeRadius(node.degree) * 0.55 * look.nodeScale

  const group = new THREE.Group()

  const uniforms = {
    uColors: { value: Array.from({ length: MAX_STRIPES }, (_, i) => colors[i] || colors[0]) },
    uCount: { value: colors.length },
    uOpacity: { value: 1 },
    uBoost: { value: 0 }
  }
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(r, 24, 16),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: STRIPE_VERTEX,
      fragmentShader: STRIPE_FRAGMENT,
      transparent: true
    })
  )
  // Tilt multi-category planets a little so the bands read as a globe
  // spinning on an axis, not flat vertical stripes.
  core.rotation.z = colors.length > 1 ? 0.35 : 0
  core.rotation.y = Math.random() * Math.PI * 2
  group.add(core)

  // An invisible, slightly larger sphere to hover/click - the visible
  // cores of small stars are only a few pixels across.
  const hitArea = new THREE.Mesh(
    new THREE.SphereGeometry(r * 2 + 1.5, 8, 6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  )
  group.add(hitArea)

  // On the bright sky, a soft dark pool behind each star so its colour
  // doesn't get lost against pink/teal clouds of a similar hue.
  let shadow = null
  if (look.sky) {
    shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color: '#1a0f3d', transparent: true, opacity: 0.45, depthWrite: false
    }))
    shadow.scale.set(r * 3.2, r * 3.2, 1)
    shadow.renderOrder = -0.5
    group.add(shadow)
  }

  // One additive halo per category, so a multi-category star's glow is a
  // blend of all its colours instead of just the first one's.
  const glows = colors.map((color, i) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: look.glowBlending
      })
    )
    const scale = r * (4 - i * 0.35)
    sprite.scale.set(scale, scale, 1)
    group.add(sprite)
    return sprite
  })


  return {
    group,
    core,
    glows,
    shadow,
    radius: r,
    title: node.title,
    uniforms,
    multi: colors.length > 1,
    glowFalloff: look.glowStrength / Math.sqrt(colors.length),
    isNew: node.isNew
  }
}

// Category-coloured and faint on the dark sky; white on the bright one,
// where the category hues get lost in the clouds.
function makeRegionLabel(category, look) {
  const label = new SpriteText(category.toUpperCase())
  label.color = look.sky ? '#ffffff' : getCategoryColor(category)
  label.userData.baseOpacity = look.sky ? 0.7 : 0.32
  label.textHeight = 11
  label.fontWeight = '600'
  label.material.transparent = true
  label.material.opacity = label.userData.baseOpacity
  label.material.depthWrite = false
  return label
}

// --- Comets (saved digests) --------------------------------------------------
// Not graph nodes: each digest is a comet on a slow elliptical orbit around
// the brain, with a fading tail. Positions are analytic (angle = f(time)),
// so the tail is just the same orbit sampled a little in the past.
// Like planets (Sarah, 2026-10-06): every comet shares one gently tilted
// plane and travels the same way round, on nested ellipses of the same
// shape - so paths never cross. The newest digest is innermost and each
// older one a ring further out (which fits relevance fading later); outer
// orbits are a little slower.
// Tilts (2026-10-07): a perfectly shared plane collapsed every orbit onto one
// line when seen edge-on, so comets on different rings looked like they were
// stacked on the same track. Like real planets, each orbit is now tilted a
// few degrees off the shared plane about its own axis, so edge-on they fan
// out instead - and the different tilts keep comets apart where rings cross
// on screen. Starting angles step by the golden angle so heads don't bunch.
const COMET_TAIL_POINTS = 48
const COMET_PLANE = new THREE.Euler(0.38, 0.6, 0.14)
const COMET_INNER_ORBIT = 1.3 // semi-major axis of the newest, in brain radii
const COMET_ORBIT_STEP = 0.2 // each older digest this much further out
const COMET_ORBIT_SHAPE = 0.72 // semi-minor / semi-major, same for all
const COMET_LAP_SEC = 300 // innermost lap; outer ones scale like planets
const COMET_TILT_MIN = 0.07 // radians (~4 deg) off the shared plane...
const COMET_TILT_MAX = 0.16 // ...up to ~9 deg, either way
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
// Clicking a comet flies to it, then the camera rides along with it.
const COMET_FLIGHT_MS = 1400
const COMET_TAIL_SPAN = 0.55 // radians of orbit behind the head
const COMET_GLOW_PUFFS = 36 // overlapping soft sprites = one smooth glowing streak

function seeded(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

// `rank`: 0 for the newest digest, 1 for the one before, and so on.
function makeComet(comet, ink, rank) {
  const rand = seeded(comet.id)
  const a = COMET_INNER_ORBIT + rank * COMET_ORBIT_STEP
  const orbit = {
    a, // semi-major axis, in brain radii
    b: COMET_ORBIT_SHAPE, // semi-minor, as a fraction of a
    phase: rank * GOLDEN_ANGLE,
    // Kepler-ish: a lap takes longer the further out (still ~5-8 minutes,
    // slow enough to click).
    speed: (Math.PI * 2) / (COMET_LAP_SEC * Math.pow(a / COMET_INNER_ORBIT, 1.5))
  }
  const group = new THREE.Group()
  // Shared plane, then this comet's own small tilt about a seeded axis lying
  // in that plane (the orbit's "line of nodes").
  const nodeAngle = rand() * Math.PI * 2
  const tilt = (COMET_TILT_MIN + rand() * (COMET_TILT_MAX - COMET_TILT_MIN)) * (rand() < 0.5 ? -1 : 1)
  const tiltQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(Math.cos(nodeAngle), 0, Math.sin(nodeAngle)), tilt)
  group.quaternion.setFromEuler(COMET_PLANE).multiply(tiltQuat)

  // Bright white on both skies; near-black ink only for flat paper embeds.
  // No fog: fog colour is the backdrop, so it faded far-off comets away.
  const color = new THREE.Color(ink ? '#1d1d33' : '#ffffff')
  const blending = ink ? THREE.NormalBlending : THREE.AdditiveBlending
  const head = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(), color, transparent: true, opacity: ink ? 0.45 : 0.4,
    depthWrite: false, blending, fog: false
  }))
  // Kept small and soft: under bloom, a bigger/brighter head read as a lens
  // flare rather than a comet.
  head.scale.set(9, 9, 1)
  head.userData.base = 9
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(), color: ink ? 0x0b0b1a : 0xffffff, transparent: true, opacity: 1,
    depthWrite: false, blending, fog: false
  }))
  core.scale.set(3, 3, 1)
  core.userData.base = 3

  const tailGeometry = new THREE.BufferGeometry()
  tailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COMET_TAIL_POINTS * 3), 3))
  // RGBA per vertex: the tail fades out by alpha, which works on both the
  // dark (additive) and light (normal-blended) skies.
  const tailColors = new Float32Array(COMET_TAIL_POINTS * 4)
  for (let i = 0; i < COMET_TAIL_POINTS; i++) {
    const fade = Math.pow(1 - i / (COMET_TAIL_POINTS - 1), 1.6)
    tailColors.set([color.r, color.g, color.b, fade], i * 4)
  }
  tailGeometry.setAttribute('color', new THREE.BufferAttribute(tailColors, 4))
  const tail = new THREE.Line(tailGeometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending, fog: false
  }))

  // A fuzzy glow along the tail, shrinking and fading away from the head.
  const puffs = Array.from({ length: COMET_GLOW_PUFFS }, (_, i) => {
    const t = (i + 1) / COMET_GLOW_PUFFS
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color, transparent: true,
      opacity: (ink ? 0.08 : 0.07) * Math.pow(1 - t, 1.5),
      depthWrite: false, blending, fog: false
    }))
    const size = 8 * (1 - t * 0.6)
    puff.scale.set(size, size, 1)
    puff.userData.base = size
    puff.userData.t = t
    return puff
  })

  group.add(tail, ...puffs, head, core)
  return { comet, orbit, group, head, core, tail, puffs }
}

// World-space sprites shrink with distance, so a zoomed-out comet vanished.
// Grow them with camera distance instead, so they keep a minimum on-screen
// size (and brightness) however far out you are.
function scaleComet(obj, camera) {
  const headWorld = obj.head.getWorldPosition(new THREE.Vector3())
  const k = Math.max(1, camera.position.distanceTo(headWorld) / 420)
  ;[obj.head, obj.core, ...obj.puffs].forEach(sprite => {
    const size = sprite.userData.base * k
    sprite.scale.set(size, size, 1)
  })
}

// Where a comet will be (in world space) at a given time - used to fly the
// camera to it, aiming for where it'll be when the flight lands.
function cometWorldPosition(obj, timeSec, radius) {
  const { a, b, phase, speed } = obj.orbit
  const A = a * radius
  const angle = phase + timeSec * speed
  obj.group.updateMatrixWorld()
  return obj.group.localToWorld(new THREE.Vector3(Math.cos(angle) * A, 0, Math.sin(angle) * b * A))
}

function placeComet(obj, timeSec, radius) {
  const { a, b, phase, speed } = obj.orbit
  const A = a * radius
  const B = b * A
  const at = (angle) => [Math.cos(angle) * A, 0, Math.sin(angle) * B]
  const angle = phase + timeSec * speed
  const [x, y, z] = at(angle)
  obj.head.position.set(x, y, z)
  obj.core.position.set(x, y, z)
  const positions = obj.tail.geometry.attributes.position
  for (let i = 0; i < COMET_TAIL_POINTS; i++) {
    const p = at(angle - (i / (COMET_TAIL_POINTS - 1)) * COMET_TAIL_SPAN)
    positions.setXYZ(i, p[0], p[1], p[2])
  }
  positions.needsUpdate = true
  obj.puffs.forEach(puff => {
    const p = at(angle - puff.userData.t * COMET_TAIL_SPAN * 0.45)
    puff.position.set(p[0], p[1], p[2])
  })
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

// --- Births ----------------------------------------------------------------
// A new star doesn't just fade in, it bursts into existence: a small, hot
// pinpoint blinks, the star pops up with a little overshoot, and a thin,
// sharp ring in its colour races outwards and is gone (Sarah's pick from
// several styles, 2026-10-05 - a soft, scaled-up ring turned into a fuzzy
// donut with a grey disc inside). The blink and ring are children of the
// star's group, counter-scaled so the star's own pop doesn't shrink them,
// and sized on screen (not in world units) so a birth reads just as clearly
// zoomed all the way out as up close.
const BIRTH_FLASH_MS = 500
const BIRTH_POP_DELAY_MS = 90
const BIRTH_RING_MS = 1000
// New memories arriving together take turns: one burst starts every
// ARRIVAL_STAGGER_MS (quicker when a lot arrive at once).
const ARRIVAL_STAGGER_MS = 650
const ARRIVAL_STAGGER_FAST_MS = 250
const ARRIVAL_FAST_AFTER = 6
// Fractions of the viewport height.
const BIRTH_FLASH_SIZE = 0.07
const BIRTH_RING_SIZE = 0.2
// Stars appearing because the timeline replay / scrubber moved forward just
// fade and grow in - no blink or ring (the burst looked silly there, Sarah
// 2026-10-06). The burst is kept for real arrivals.
const QUIET_BIRTH_MS = 700

let sparkTextureCache = null
let ringTextureCache = null
function birthTextures() {
  if (sparkTextureCache) return { spark: sparkTextureCache, ring: ringTextureCache }
  const size = 256
  const c = size / 2
  const make = (draw) => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    draw(canvas.getContext('2d'))
    return new THREE.CanvasTexture(canvas)
  }
  // The blink: a small, hot pinpoint rather than a wide soft glow.
  sparkTextureCache = make(ctx => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.08, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.22, 'rgba(255,255,255,0.3)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.06)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  })
  // The ring: a thin line with a small glow, stroked twice for a bright core.
  ringTextureCache = make(ctx => {
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = size * 0.012
    ctx.shadowColor = '#fff'
    ctx.shadowBlur = size * 0.025
    ctx.beginPath()
    ctx.arc(c, c, size * 0.44, 0, Math.PI * 2)
    ctx.stroke()
    ctx.stroke()
  })
  return { spark: sparkTextureCache, ring: ringTextureCache }
}

function startBirth(obj, look, reduceMotion, quiet = false) {
  obj.group.scale.setScalar(0.001)
  obj.quietBirth = quiet
  if (reduceMotion || quiet) return
  const { spark, ring } = birthTextures()
  const sprite = (map, color) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map, color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: look.glowBlending, sizeAttenuation: false
    }))
    s.renderOrder = 10
    obj.group.add(s)
    return s
  }
  obj.birthFx = {
    flash: sprite(spark, '#ffffff'),
    ring: sprite(ring, obj.glows[0]?.material.color ?? '#ffffff')
  }
}

function endBirth(obj) {
  if (!obj.birthFx) return
  Object.values(obj.birthFx).forEach(sprite => {
    obj.group.remove(sprite)
    sprite.material.dispose()
  })
  obj.birthFx = null
}

// Advances one star's birth; returns its 0-1 progress (1 = done).
function stepBirth(obj, elapsed, reduceMotion) {
  const gentle = reduceMotion || obj.quietBirth
  const total = reduceMotion ? 300 : obj.quietBirth ? QUIET_BIRTH_MS : BIRTH_POP_DELAY_MS + BIRTH_MS
  const progress = Math.min(1, elapsed / total)
  if (gentle) {
    obj.group.scale.setScalar(Math.max(0.001, easeOutCubic(progress)))
    obj.glows.forEach(g => { g.material.opacity = obj.baseGlow * progress })
    return progress
  }

  const pop = Math.max(0, Math.min(1, (elapsed - BIRTH_POP_DELAY_MS) / BIRTH_MS))
  const scale = Math.max(0.001, easeOutBack(pop))
  obj.group.scale.setScalar(scale)
  // Halo starts several times too bright and settles to its normal glow.
  const flare = 1 + Math.pow(1 - pop, 2) * 5
  obj.glows.forEach(g => { g.material.opacity = obj.baseGlow * flare })

  const { flash, ring } = obj.birthFx || {}
  if (flash) {
    // Snaps on in ~60 ms, then decays: the blink.
    const f = elapsed / BIRTH_FLASH_MS
    flash.material.opacity = f < 0.12 ? f / 0.12 : Math.max(0, 1 - (f - 0.12) / 0.88) ** 2
    flash.scale.setScalar((BIRTH_FLASH_SIZE * (0.6 + 0.4 * Math.min(1, f * 3))) / scale)
  }
  if (ring) {
    // Starts just outside the star, races out, and is gone - no lingering.
    const t = Math.min(1, elapsed / BIRTH_RING_MS)
    ring.material.opacity = Math.min(1, t * 10) * (1 - t) ** 1.8
    ring.scale.setScalar((BIRTH_RING_SIZE * (0.12 + (1 - Math.pow(1 - t, 4)) * 0.88)) / scale)
  }
  return progress
}

function BrainGraph3D({
  nodes, edges,
  visibleNodeIds, highlightNodeIds, newNodeIds, selectedNodeId,
  focusRequest, recenterRequest,
  // { ids: Set, nonce } - frame these stars, even while non-interactive.
  frameRequest = null,
  onNodeClick, onBackgroundClick,
  // Fired when the user finishes dragging the view round (First Light
  // waits for this before moving on).
  onOrbit,
  // Stars that join an already-loaded map burst into existence (a memory
  // arriving from Claude, the intro's first stars). Off for the very first
  // load, so opening the app doesn't set off every star at once.
  animateArrivals = false,
  // Whether arrivals may burst in now. While false (the brain is only a
  // backdrop behind Home etc.) they wait, hidden, so you see them arrive
  // when you open Explore rather than missing it.
  revealArrivals = true,
  comets = null, onCometClick, showComets = true, cometFocusRequest = null,
  // The comet whose digest is open: the camera follows it round its orbit.
  followCometId = null,
  look: lookName = 'galaxy',
  palette: paletteOverride,
  interactive = true,
  autoRotateSpeed = 0.35,
  // Keep the view still (no auto-rotate) - First Light's "click a star".
  holdStill = false
}) {
  const look = LOOKS[lookName] || LOOKS.galaxy
  const palette = { ...DEFAULT_PALETTE, ...paletteOverride }
  const containerRef = useRef(null)
  const labelsRef = useRef(null)
  const graphRef = useRef(null)
  const callbacksRef = useRef({})
  callbacksRef.current = { onNodeClick, onBackgroundClick, onCometClick, onOrbit }

  // Everything the imperative three.js side reads - kept in one ref so the
  // graph's callbacks (created once) always see the latest values.
  const s = useRef({
    starObjects: new Map(), // node id -> makeStarObject() result
    nodesById: new Map(), // node id -> original app node (with .data)
    neighbors: new Map(), // node id -> Set of connected node ids
    regionLabels: new Map(), // category -> SpriteText
    visible: null,
    highlight: null,
    hoveredId: null,
    selectedId: null,
    births: new Map(), // node id -> start time of its birth burst
    pendingBirths: new Set(),
    quietBirths: new Set(), // pending/under-way births from the timeline (no burst)
    arrivalsArmed: false, // a loaded map exists, so new ids are arrivals
    arrivalQueue: [], // arrived ids still hidden, waiting for their turn
    lastArrivalAt: 0,
    revealArrivals,
    engineSettled: false,
    pendingCamera: null,
    lastInteraction: 0,
    positionsReady: false,
    interactive,
    applyQueued: false,
    focusLines: [],
    comets: [], // makeComet() results
    showComets,
    labelEls: new Map(), // key -> DOM label currently on screen
    brainRadius: 400,
    hoveredComet: null,
    follow: null, // { id, startAt, last } - the comet the camera is riding along with
    focusLinesFor: null,
    holdStill
  }).current

  // --- presentation: mutate existing objects in place ----------------------
  const applyRef = useRef(null)
  applyRef.current = () => {
    const focusId = s.hoveredId ?? s.selectedId
    const focusSet = focusId ? s.neighbors.get(focusId) || new Set() : null
    const highlight = s.highlight
    const labelAllHighlighted = highlight && highlight.size <= 12

    s.starObjects.forEach((obj, id) => {
      let opacity = 1
      let glow = obj.isNew ? 0.55 : 0.32
      let boost = 0
      let showLabel = id === s.hoveredId || id === s.selectedId

      if (focusId) {
        if (id === focusId) {
          glow *= 1.8
          boost = 0.5
        } else if (!focusSet.has(id)) {
          opacity = 0.12
          glow *= 0.15
        }
      } else if (highlight) {
        if (highlight.has(id)) {
          glow *= 2.2
          boost = 0.6
          showLabel = showLabel || labelAllHighlighted
        } else {
          opacity = 0.1
          glow *= 0.12
        }
      }

      obj.uniforms.uOpacity.value = opacity
      obj.uniforms.uBoost.value = boost
      obj.baseGlow = glow * obj.glowFalloff
      obj.glows.forEach(g => { g.material.opacity = obj.baseGlow })
      if (obj.shadow) obj.shadow.material.opacity = 0.45 * opacity
      obj.labelMode = id === s.hoveredId || id === s.selectedId ? 'focus' : showLabel ? 'match' : null
    })

    s.regionLabels.forEach(label => {
      label.userData.dim = focusId || highlight ? 0.4 : 1
    })

    const graph = graphRef.current
    if (!graph) return
    graph.graphData().links.forEach(link => {
      const mat = link.__mat
      if (!mat) return
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source
      const targetId = typeof link.target === 'object' ? link.target.id : link.target
      const touchesFocus = focusId && (sourceId === focusId || targetId === focusId)
      const withinHighlight = highlight && highlight.has(sourceId) && highlight.has(targetId)
      let alpha = link.baseAlpha
      if (focusId) {
        alpha = touchesFocus ? Math.min(1, alpha * 2 + 0.3) : alpha * 0.12
      } else if (highlight) {
        alpha = withinHighlight ? Math.min(1, alpha * 1.8) : alpha * 0.1
      }
      link.targetAlpha = alpha
      mat.opacity = alpha
      mat.visible = link.backbone || touchesFocus || withinHighlight
    })

    if (focusId !== s.focusLinesFor) rebuildFocusLines(focusId)
  }

  // Glowing, constant-pixel-width lines for the focused star's links, drawn
  // on top of the hairlines (Line2 widths are in screen pixels, so they
  // don't balloon when you zoom in the way the old tube links did).
  const rebuildFocusLines = (focusId) => {
    const graph = graphRef.current
    s.focusLinesFor = focusId
    if (s.focusLines) {
      s.focusLines.forEach(({ line }) => {
        line.parent?.remove(line)
        line.geometry.dispose()
        line.material.dispose()
      })
    }
    s.focusLines = []
    if (!graph || !focusId) return
    const size = new THREE.Vector2()
    graph.renderer().getSize(size)
    graph.graphData().links.forEach(link => {
      const source = typeof link.source === 'object' ? link.source : null
      const target = typeof link.target === 'object' ? link.target : null
      if (!source || !target || (source.id !== focusId && target.id !== focusId)) return
      if (s.visible && (!s.visible.has(source.id) || !s.visible.has(target.id))) return
      const material = new LineMaterial({
        color: link.__mat.color.getHex(),
        linewidth: FOCUS_LINE_WIDTH,
        transparent: true,
        opacity: 0.55 + link.strength * 0.4,
        depthWrite: false
      })
      material.resolution.set(size.x, size.y)
      const line = new Line2(new LineGeometry(), material)
      graph.scene().add(line)
      s.focusLines.push({ line, source, target })
    })
    updateFocusLines()
  }

  const updateFocusLines = () => {
    if (!s.focusLines) return
    s.focusLines.forEach(({ line, source, target }) => {
      line.geometry.setPositions([source.x, source.y, source.z, target.x, target.y, target.z])
      line.computeLineDistances()
    })
  }

  // Comets are small and moving, so hit-test in screen pixels (distance from
  // the pointer to the projected head) rather than raycasting a sphere
  // that's only a few pixels wide from typical zoom levels.
  const COMET_HIT_PX = 28
  const cometAt = (event) => {
    const graph = graphRef.current
    if (!graph || s.comets.length === 0 || !event || !s.showComets) return null
    const rect = graph.renderer().domElement.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const world = new THREE.Vector3()
    let best = null
    let bestDist = COMET_HIT_PX
    s.comets.forEach(c => {
      c.head.getWorldPosition(world)
      const ndc = world.project(graph.camera())
      if (ndc.z > 1) return // behind the camera
      const dx = (ndc.x + 1) / 2 * rect.width - px
      const dy = (1 - ndc.y) / 2 * rect.height - py
      const dist = Math.hypot(dx, dy)
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    })
    return best
  }

  // Star titles are HTML, not WebGL text: crisp at any zoom, never smeared
  // by the bloom pass, and given a solid backdrop so they read over busy
  // parts of the map. Re-positioned every frame over their star.
  const updateLabels = () => {
    const graph = graphRef.current
    const layer = labelsRef.current
    if (!graph || !layer) return
    const width = layer.clientWidth
    const height = layer.clientHeight
    const camera = graph.camera()
    const world = new THREE.Vector3()
    const wanted = new Map()

    s.starObjects.forEach((obj, id) => {
      if (!obj.labelMode || !obj.group.parent || obj.awaitingBirth) return
      wanted.set(`n:${id}`, { obj3d: obj.group, text: obj.title, mode: obj.labelMode, lift: obj.radius })
    })
    if (s.hoveredComet) {
      wanted.set(`c:${s.hoveredComet.comet.id}`, { obj3d: s.hoveredComet.head, text: s.hoveredComet.comet.label, mode: 'comet', lift: 14 })
    }

    s.labelEls.forEach((el, key) => {
      if (!wanted.has(key)) {
        el.remove()
        s.labelEls.delete(key)
      }
    })
    wanted.forEach(({ obj3d, text, mode, lift }, key) => {
      let el = s.labelEls.get(key)
      if (!el) {
        el = document.createElement('div')
        layer.appendChild(el)
        s.labelEls.set(key, el)
      }
      if (el.textContent !== text) el.textContent = text
      el.className = `brain-label is-${mode}`
      obj3d.getWorldPosition(world)
      // Lift the label above the star's top edge (in screen space).
      const edge = world.clone().add(camera.up.clone().multiplyScalar(lift))
      const p = world.project(camera)
      const q = edge.project(camera)
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) {
        el.style.display = 'none'
        return
      }
      el.style.display = ''
      const x = (p.x + 1) / 2 * width
      const y = (1 - Math.max(p.y, q.y)) / 2 * height
      el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 8).toFixed(1)}px) translate(-50%, -100%)`
    })
  }

  // Keep the zoom-out limit (and the backdrop) in proportion to the brain.
  const updateBounds = () => {
    const graph = graphRef.current
    if (!graph) return
    let radius = 0
    graph.graphData().nodes.forEach(n => {
      if (n.x !== undefined) radius = Math.max(radius, Math.hypot(n.x, n.y, n.z))
    })
    if (radius > 0) s.brainRadius = radius
    const maxDistance = Math.max(MIN_MAX_DISTANCE, radius * MAX_DISTANCE_PER_RADIUS)
    graph.controls().maxDistance = maxDistance
    s.galaxy?.scale.setScalar(Math.max(1, maxDistance / GALAXY_BASE_DISTANCE))
  }

  // Camera moves (fly to a node, frame a search) can arrive before the
  // layout has placed anything - hold them until the simulation settles.
  const runCamera = (request) => {
    const graph = graphRef.current
    if (!graph) return
    const node = request.type === 'focus' ? graph.graphData().nodes.find(n => n.id === request.id) : null
    const ready = request.type === 'focus' ? node && node.x !== undefined : s.engineSettled || s.positionsReady
    if (!ready) {
      s.pendingCamera = request
      return
    }
    s.pendingCamera = null
    // 3d-force-graph sets its own initial camera distance in its (deferred)
    // update after a graphData load - move the camera after that, not before.
    setTimeout(() => moveCamera(request), 50)
  }

  const moveCamera = (request) => {
    const graph = graphRef.current
    if (!graph) return
    // Any other camera move (a star, recentre, search) stops riding a comet.
    if (request.type !== 'comet') s.follow = null
    if (request.type === 'focus') {
      const node = graph.graphData().nodes.find(n => n.id === request.id)
      if (!node) return
      const len = Math.hypot(node.x, node.y, node.z) || 1
      const ratio = 1 + FOCUS_DISTANCE / len
      graph.cameraPosition(
        { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
        { x: node.x, y: node.y, z: node.z },
        1200
      )
    } else if (request.type === 'comet') {
      const comet = s.comets.find(c => c.comet.id === request.id)
      if (!comet) return
      const target = cometWorldPosition(comet, (performance.now() + COMET_FLIGHT_MS) / 1000, s.brainRadius)
      const dir = target.clone().normalize()
      const position = target.clone().addScaledVector(dir, 380)
      graph.cameraPosition({ x: position.x, y: position.y, z: position.z }, { x: target.x, y: target.y, z: target.z }, COMET_FLIGHT_MS)
      // Ride along once the flight has landed (before that the flight's own
      // tween is moving the camera).
      if (s.follow?.id === comet.comet.id) {
        s.follow.startAt = performance.now() + COMET_FLIGHT_MS + 50
        s.follow.last = null
      }
    } else if (request.type === 'home') {
      const count = graph.graphData().nodes.length || 1
      const z = Math.min(Math.cbrt(count) * 170, graph.controls().maxDistance * 0.9)
      graph.cameraPosition({ x: 0, y: 0, z }, { x: 0, y: 0, z: 0 }, 1200)
    } else if (request.type === 'fit') {
      // Framed from the nodes' layout coordinates rather than zoomToFit(),
      // which measures rendered object transforms - stale until a frame has
      // been drawn, so it frames the wrong spot right after a remount.
      const points = graph.graphData().nodes
        .filter(n => request.ids.has(n.id) && n.x !== undefined)
        .map(n => new THREE.Vector3(n.x, n.y, n.z))
      if (points.length === 0) return
      const center = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(points.length)
      const radius = Math.max(40, ...points.map(p => p.distanceTo(center))) + 30
      const camera = graph.camera()
      const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
      const direction = camera.position.clone().sub(graph.controls().target).normalize()
      if (direction.lengthSq() === 0) direction.set(0, 0, 1)
      const position = center.clone().addScaledVector(direction, distance)
      graph.cameraPosition(
        { x: position.x, y: position.y, z: position.z },
        { x: center.x, y: center.y, z: center.z },
        1200
      )
    }
  }

  // --- one-time scene setup --------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    // Orbit (not the default trackball) controls: they support auto-rotate,
    // min/max zoom distance, and damping.
    const graph = new ForceGraph3D(containerRef.current, {
      controlType: 'orbit',
      ...(look.transparent ? { rendererConfig: { alpha: true, antialias: true } } : {})
    })
      .backgroundColor(look.transparent ? 'rgba(0,0,0,0)' : look.background)
      .cooldownTime(Infinity)
      .showNavInfo(false)
      .nodeRelSize(1)
      .nodeLabel(() => '')
      .nodeThreeObjectExtend(false)
      .nodeThreeObject(node => {
        const obj = makeStarObject(node, palette, look)
        s.starObjects.set(node.id, obj)
        // A birth already under way (the map rebuilt mid-burst) carries on
        // with the new object instead of starting over.
        if (s.arrivalQueue.includes(node.id)) {
          obj.group.scale.setScalar(0.001) // hidden until its turn
          obj.awaitingBirth = true
        } else if (s.pendingBirths.has(node.id) || s.births.has(node.id)) {
          s.pendingBirths.delete(node.id)
          if (!s.births.has(node.id)) s.births.set(node.id, performance.now())
          startBirth(obj, look, reduceMotion, s.quietBirths.has(node.id))
        }
        // Objects are created in bursts (initial load, a scrub step) - style
        // them all in one pass afterwards rather than once per star.
        if (!s.applyQueued) {
          s.applyQueued = true
          queueMicrotask(() => {
            s.applyQueued = false
            applyRef.current()
          })
        }
        return obj.group
      })
      .nodeVisibility(node => !s.visible || s.visible.has(node.id))
      .linkVisibility(link => {
        if (!s.visible) return true
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source
        const targetId = typeof link.target === 'object' ? link.target.id : link.target
        return s.visible.has(sourceId) && s.visible.has(targetId)
      })
      // Width 0 = plain 1px WebGL lines, which stay hairline-thin however far
      // you zoom in (the old 3D tubes got fatter the closer you got, which
      // is what made close-ups a wall of purple). The focused star's links
      // get a separate glowing overlay instead - see updateFocusLines().
      .linkWidth(0)
      .linkMaterial(l => l.__mat)
      .linkDirectionalParticles(l => (l.backbone && l.strength > 0.7 ? 1 : 0))
      .linkDirectionalParticleColor(l => l.particleColor)
      .linkDirectionalParticleWidth(1.4)
      .linkDirectionalParticleSpeed(0.004)
      .onNodeHover(node => {
        if (containerRef.current) containerRef.current.style.cursor = node ? 'pointer' : 'default'
        s.hoveredId = node?.id ?? null
        applyRef.current()
      })
      .onNodeClick(node => {
        s.lastInteraction = performance.now()
        const original = s.nodesById.get(node.id)
        if (original) callbacksRef.current.onNodeClick?.(original)
      })
      .onBackgroundClick((event) => {
        const hit = cometAt(event)
        if (hit) callbacksRef.current.onCometClick?.(hit.comet)
        else callbacksRef.current.onBackgroundClick?.()
      })
      .onEngineTick(() => {
        s.engineSettled = false
      })
      .onEngineStop(() => {
        s.engineSettled = true
        updateBounds()
        graph.graphData().nodes.forEach(n => positionCache.set(n.id, { x: n.x, y: n.y, z: n.z }))
        positionCacheSettled = true
        if (s.pendingCamera) runCamera(s.pendingCamera)
      })

    if (look.galaxy) {
      s.galaxy = buildGalaxy(look.light)
      graph.scene().add(s.galaxy)
      // No fog on the gradient sky - a single fog colour can't match it.
      if (!look.sky) graph.scene().fog = new THREE.FogExp2(new THREE.Color(look.background).getHex(), 0.0008)
    }

    if (look.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight
      ), look.bloomStrength ?? 0.55, 0.4, look.bloomThreshold ?? 0.3)
      const composer = graph.postProcessingComposer()
      composer.addPass(bloom)
      composer.addPass(new OutputPass())
    }

    if (!s.interactive) {
      // Pure backdrop: no orbiting, hovering or clicking, so the page on
      // top scrolls and clicks exactly as if the canvas weren't there.
      graph.enableNavigationControls(false).enablePointerInteraction(false)
    }

    // Slow auto-rotate that gets out of the way: it pauses while you're
    // dragging/zooming or have a star selected, and resumes after a while.
    const controls = graph.controls()
    controls.autoRotateSpeed = autoRotateSpeed
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 25
    const markInteraction = () => { s.lastInteraction = performance.now() }
    // A drag that actually turned the view (not just a click) counts as an
    // orbit - measured as the angle the camera swung round its target,
    // including the glide after letting go (damping does most of the turn).
    let dragFrom = null
    const onControlsStart = () => {
      markInteraction()
      dragFrom = graph.camera().position.clone().sub(controls.target)
    }
    const onControlsChange = () => {
      if (!dragFrom) return
      const now = graph.camera().position.clone().sub(controls.target)
      if (dragFrom.angleTo(now) > 0.2) {
        dragFrom = null
        callbacksRef.current.onOrbit?.()
      }
    }
    controls.addEventListener('start', onControlsStart)
    controls.addEventListener('change', onControlsChange)
    controls.addEventListener('end', markInteraction)

    graphRef.current = graph

    let raf
    const animate = (now) => {
      galaxyTime.value = now / 1000
      if (!s.engineSettled) updateFocusLines()
      controls.autoRotate = !reduceMotion && !s.holdStill && !s.selectedId && !s.hoveredId && !s.follow && now - s.lastInteraction > AUTOROTATE_RESUME_MS
      // Non-interactive embeds have no controls listening, so rotate by hand.
      if (!s.interactive && controls.autoRotate) controls.update()

      // Next arrival's turn?
      if (s.arrivalQueue.length && s.revealArrivals) {
        const gap = s.arrivalQueue.length > ARRIVAL_FAST_AFTER ? ARRIVAL_STAGGER_FAST_MS : ARRIVAL_STAGGER_MS
        if (now - s.lastArrivalAt >= gap) {
          const id = s.arrivalQueue.shift()
          const obj = s.starObjects.get(id)
          if (obj) {
            obj.awaitingBirth = false
            s.births.set(id, now)
            startBirth(obj, look, reduceMotion)
          }
          s.lastArrivalAt = now
        }
      }

      const birthProgress = s.births.size || s.arrivalQueue.length ? new Map() : null
      s.arrivalQueue.forEach(id => birthProgress.set(id, 0))
      s.starObjects.forEach((obj, id) => {
        if (obj.multi) obj.core.rotation.y += 0.004
        const born = s.births.get(id)
        if (obj.awaitingBirth) return
        if (born === undefined) {
          // Memories captured since your last visit breathe gently.
          if (obj.isNew) {
            const pulse = 1 + 0.7 * (0.5 + 0.5 * Math.sin(now / 380))
            obj.glows.forEach(g => { g.material.opacity = obj.baseGlow * pulse })
          }
          return
        }
        const t = stepBirth(obj, now - born, reduceMotion)
        birthProgress.set(id, t)
        if (t >= 1) {
          endBirth(obj)
          s.births.delete(id)
          s.quietBirths.delete(id)
          obj.quietBirth = false
        }
      })
      // A newborn star's links fade in with it rather than being there first.
      if (birthProgress) {
        graph.graphData().links.forEach(link => {
          if (!link.__mat) return
          const a = birthProgress.get(link.source?.id ?? link.source)
          const b = birthProgress.get(link.target?.id ?? link.target)
          if (a === undefined && b === undefined) return
          const t = Math.min(a ?? 1, b ?? 1)
          link.__mat.opacity = (link.targetAlpha ?? link.baseAlpha) * t * t
        })
      }

      s.comets.forEach(c => {
        placeComet(c, now / 1000, s.brainRadius)
        scaleComet(c, graph.camera())
      })
      // Following a comet: move the camera and its target by however far the
      // comet moved this frame, so it stays in view while you can still drag
      // to look around it or zoom.
      if (s.follow && now >= s.follow.startAt) {
        const followed = s.comets.find(c => c.comet.id === s.follow.id)
        if (followed) {
          const at = followed.head.getWorldPosition(new THREE.Vector3())
          if (s.follow.last) {
            const delta = at.clone().sub(s.follow.last)
            graph.camera().position.add(delta)
            controls.target.add(delta)
          }
          s.follow.last = at
        }
      }
      updateLabels()

      // A region label only shows once enough visible stars carry that
      // category (so they appear one by one during a timeline replay, and a
      // category with a stray memory or two doesn't leave a label floating
      // in empty space). Labels on the far side of the brain fade, so it's
      // clear they're behind the clusters rather than naming them.
      if (s.regionLabels.size) {
        const counts = new Map()
        graph.graphData().nodes.forEach(n => {
          if (s.visible && !s.visible.has(n.id)) return
          n.categories.forEach(c => counts.set(c, (counts.get(c) || 0) + 1))
        })
        const toCamera = graph.camera().position.clone().normalize()
        s.regionLabels.forEach((label, category) => {
          label.visible = (counts.get(category) || 0) >= REGION_LABEL_MIN_STARS
          if (!label.visible) return
          const facing = label.position.clone().normalize().dot(toCamera)
          const depth = 0.15 + 0.85 * THREE.MathUtils.smoothstep(facing, -0.6, 0.6)
          label.material.opacity = label.userData.baseOpacity * (label.userData.dim ?? 1) * depth
        })
      }

      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)

    // Comets aren't graph nodes, so hover is our own raycast.
    const onPointerMove = (event) => {
      if (!s.interactive || s.comets.length === 0) return
      const hit = cometAt(event)
      if (hit === s.hoveredComet) return
      s.hoveredComet = hit
      if (containerRef.current && !s.hoveredId) containerRef.current.style.cursor = hit ? 'pointer' : 'default'
    }
    containerRef.current.addEventListener('pointermove', onPointerMove)

    const resize = () => {
      if (!containerRef.current) return
      graph.width(containerRef.current.clientWidth)
      graph.height(containerRef.current.clientHeight)
      s.focusLines.forEach(({ line }) => {
        line.material.resolution.set(containerRef.current.clientWidth, containerRef.current.clientHeight)
      })
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(containerRef.current)

    return () => {
      cancelAnimationFrame(raf)
      graph.graphData().nodes.forEach(n => {
        if (n.x !== undefined) positionCache.set(n.id, { x: n.x, y: n.y, z: n.z })
      })
      positionCacheSettled = s.engineSettled
      resizeObserver.disconnect()
      containerRef.current?.removeEventListener('pointermove', onPointerMove)
      controls.removeEventListener('start', onControlsStart)
      controls.removeEventListener('change', onControlsChange)
      controls.removeEventListener('end', markInteraction)
      graph._destructor?.()
      if (containerRef.current) containerRef.current.innerHTML = ''
      graphRef.current = null
    }
  }, [])

  // --- structure: only when the memories themselves change -------------------
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return

    const nodesById = new Map(nodes.map(n => [n.id, n]))
    s.nodesById = nodesById
    const graphTheme = look.light ? LIGHT_GRAPH_THEME : DARK_GRAPH_THEME

    const degreeMap = new Map()
    const neighbors = new Map()
    edges.forEach(e => {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1)
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1)
      if (!neighbors.has(e.source)) neighbors.set(e.source, new Set())
      if (!neighbors.has(e.target)) neighbors.set(e.target, new Set())
      neighbors.get(e.source).add(e.target)
      neighbors.get(e.target).add(e.source)
    })
    s.neighbors = neighbors

    // Reuse positions from the previous layout so a new memory arriving
    // doesn't scatter everything that was already placed.
    const previous = new Map(graph.graphData().nodes.map(n => [n.id, n]))
    if (s.arrivalsArmed) {
      nodes.forEach(n => {
        if (!previous.has(n.id) && !s.arrivalQueue.includes(n.id)) s.arrivalQueue.push(n.id)
      })
    } else if (animateArrivals) {
      // The first real load: memories that came in while the app was closed
      // ("new since your last visit") get their burst too, oldest first.
      nodes
        .filter(n => newNodeIds?.has(n.id))
        .sort((a, b) => (a.data.timestamp || '').localeCompare(b.data.timestamp || ''))
        .forEach(n => s.arrivalQueue.push(n.id))
    }
    // Arm only after a load the parent says is real, so the initial fetch
    // (empty -> everything) never counts as everything arriving at once.
    s.arrivalsArmed = animateArrivals
    const graphNodes = nodes.map(n => {
      const prev = previous.get(n.id) || positionCache.get(n.id)
      return {
        id: n.id,
        title: n.data.title,
        categories: n.data.anonymous ? [] : nodeCategoryList(n.data),
        anonymous: Boolean(n.data.anonymous),
        degree: degreeMap.get(n.id) || 0,
        isNew: newNodeIds?.has(n.id) || false,
        ...(prev && prev.x !== undefined ? { x: prev.x, y: prev.y, z: prev.z } : {})
      }
    })

    const graphLinks = edges.map(e => {
      const strength = e.data?.strength ?? 0.6
      const t = Math.max(0, Math.min(1, (strength - 0.6) / 0.4))
      const sourceData = nodesById.get(e.source)?.data
      const targetData = nodesById.get(e.target)?.data
      const anonymousEnd = sourceData?.anonymous || targetData?.anonymous
      // White on the bright sky - category tints vanish into the clouds.
      const rgb = palette.linkRgb
        || (look.sky && '255, 255, 255')
        || (!anonymousEnd && sourceData && targetData && categoryBridgeRgb(sourceData, targetData))
        || graphTheme.edgeColorRgb
      const baseAlpha = graphTheme.edgeAlphaBase + t * graphTheme.edgeAlphaRange
      return {
        source: e.source,
        target: e.target,
        strength: t,
        rawStrength: strength,
        backbone: false,
        baseAlpha,
        particleColor: `rgb(${rgb})`,
        __mat: new THREE.LineBasicMaterial({
          color: new THREE.Color(`rgb(${rgb})`),
          transparent: true,
          opacity: baseAlpha,
          depthWrite: false
        })
      }
    })

    // Backbone: each node's strongest few links.
    const linksByNode = new Map()
    graphLinks.forEach(link => {
      ;[link.source, link.target].forEach(id => {
        if (!linksByNode.has(id)) linksByNode.set(id, [])
        linksByNode.get(id).push(link)
      })
    })
    linksByNode.forEach(list => {
      list
        .sort((a, b) => b.rawStrength - a.rawStrength)
        .slice(0, BACKBONE_LINKS_PER_NODE)
        .forEach(link => { link.backbone = true })
    })

    // Category homes + region labels.
    const present = new Set(graphNodes.flatMap(n => n.categories))
    const homes = layoutCategoryHomes(present, categoryAffinity(nodes, edges, nodesById))
    s.regionLabels.forEach(label => label.parent?.remove(label))
    s.regionLabels = new Map()
    homes.forEach((home, category) => {
      if (!look.regionLabels) return
      const label = makeRegionLabel(category, look)
      // Pinned just outside the category's home point rather than the live
      // centroid of its stars: the homes are spread apart by the layout
      // above, so labels can't pile on top of each other in the dense middle.
      label.position.copy(home).multiplyScalar(1.3)
      graph.scene().add(label)
      s.regionLabels.set(category, label)
    })

    s.starObjects = new Map()
    s.focusLinesFor = undefined // node objects are new - force a rebuild
    s.engineSettled = false
    const restored = positionCacheSettled && graphNodes.length > 0 && graphNodes.every(n => n.x !== undefined)
    // Every star already has a settled position from a previous visit -
    // don't reheat the simulation (it would re-spread the map and undo any
    // camera framing). Otherwise lay the map out synchronously before the
    // first frame (warmup), then let it drift into place for a moment.
    // Both limits are in ticks, not wall-clock time, so a backgrounded tab
    // can't "finish" a layout that never actually ran.
    graph
      .warmupTicks(restored ? 0 : WARMUP_TICKS)
      .cooldownTicks(restored ? 0 : COOLDOWN_TICKS)
    s.positionsReady = graphNodes.length > 0
    graph.graphData({ nodes: graphNodes, links: graphLinks })
    // Warmup/restored positions exist now - size the universe to them.
    setTimeout(updateBounds, 60)

    graph.d3Force('charge').strength(-110)
    graph.d3Force('link').distance(d => 60 + (1 - d.strength) * 90)
    const clusterTarget = (node, axis) => {
      const points = node.categories.map(c => homes.get(c)).filter(Boolean)
      if (points.length === 0) return 0
      return points.reduce((sum, p) => sum + p[axis], 0) / points.length
    }
    graph.d3Force('categoryX', forceX(n => clusterTarget(n, 'x')).strength(0.025))
    graph.d3Force('categoryY', forceY(n => clusterTarget(n, 'y')).strength(0.025))
    graph.d3Force('categoryZ', forceZ(n => clusterTarget(n, 'z')).strength(0.025))
  }, [nodes, edges, newNodeIds])

  // --- timeline / category filter: which stars exist -------------------------
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    const before = s.visible
    // Stars appearing because the playhead moved forward fade in (quietly,
    // see QUIET_BIRTH_MS); the very first render and "back to all time" don't.
    if (before && visibleNodeIds) {
      visibleNodeIds.forEach(id => {
        if (!before.has(id)) { s.pendingBirths.add(id); s.quietBirths.add(id) }
      })
    }
    s.visible = visibleNodeIds
    // Re-assigning the accessors makes three-forcegraph re-run its visibility
    // digest (adding/removing objects) without touching the simulation.
    graph.nodeVisibility(graph.nodeVisibility())
    graph.linkVisibility(graph.linkVisibility())
    applyRef.current()
  }, [visibleNodeIds])

  // --- search glow -----------------------------------------------------------
  useEffect(() => {
    s.highlight = highlightNodeIds
    applyRef.current()
    // Only fly the camera while you're actually exploring - as Home's
    // backdrop the brain just lights matches up where they are.
    if (s.interactive && highlightNodeIds && highlightNodeIds.size > 0) {
      runCamera({ type: 'fit', ids: highlightNodeIds })
    }
  }, [highlightNodeIds])

  // Comets: rebuilt only when the list of digests changes.
  const cometKey = (comets || []).map(c => c.id).join('|')
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    s.comets.forEach(c => {
      c.group.parent?.remove(c.group)
      c.tail.geometry.dispose()
    })
    // Newest digest first (rank 0, the innermost orbit).
    const byAge = [...(comets || [])].sort((x, y) => (y.digest?.period_end || '').localeCompare(x.digest?.period_end || ''))
    s.comets = byAge.map((c, rank) => makeComet(c, look.light && !look.galaxy, rank))
    s.comets.forEach(c => { c.group.visible = s.showComets })
    s.comets.forEach(c => graph.scene().add(c.group))
    s.hoveredComet = null
  }, [cometKey])

  useEffect(() => {
    if (!cometFocusRequest || cometFocusRequest.nonce === lastCometFocusNonce) return
    lastCometFocusNonce = cometFocusRequest.nonce
    runCamera({ type: 'comet', id: cometFocusRequest.id })
  }, [cometFocusRequest])

  useEffect(() => {
    if (!followCometId) {
      s.follow = null
      return
    }
    if (s.follow?.id === followCometId) return
    s.follow = { id: followCometId, startAt: Infinity, last: null }
    runCamera({ type: 'comet', id: followCometId })
  }, [followCometId])

  useEffect(() => {
    s.showComets = showComets
    s.comets.forEach(c => { c.group.visible = showComets })
    if (!showComets) s.hoveredComet = null
  }, [showComets])

  // Backdrop <-> explore without rebuilding anything.
  useEffect(() => {
    const graph = graphRef.current
    if (!graph || s.interactive === interactive) return
    s.interactive = interactive
    graph.enableNavigationControls(interactive).enablePointerInteraction(interactive)
    if (!interactive) {
      s.hoveredId = null
      if (containerRef.current) containerRef.current.style.cursor = 'default'
      applyRef.current()
    } else if (s.highlight && s.highlight.size > 0) {
      runCamera({ type: 'fit', ids: s.highlight })
    }
  }, [interactive])

  useEffect(() => { s.holdStill = holdStill }, [holdStill])
  // Opening Explore releases any waiting arrivals - the first a beat after
  // the page has settled, then the rest in turn.
  useEffect(() => {
    if (revealArrivals && !s.revealArrivals) s.lastArrivalAt = performance.now() - ARRIVAL_STAGGER_MS + 500
    s.revealArrivals = revealArrivals
  }, [revealArrivals])

  useEffect(() => {
    s.selectedId = selectedNodeId
    applyRef.current()
  }, [selectedNodeId])

  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastFocusNonce) return
    lastFocusNonce = focusRequest.nonce
    runCamera({ type: 'focus', id: focusRequest.id })
  }, [focusRequest])

  useEffect(() => {
    if (!frameRequest || frameRequest.ids.size === 0) return
    runCamera({ type: 'fit', ids: frameRequest.ids })
  }, [frameRequest])

  useEffect(() => {
    if (!recenterRequest || recenterRequest === lastRecenterNonce) return
    lastRecenterNonce = recenterRequest
    runCamera({ type: 'home' })
  }, [recenterRequest])

  return (
    <div className="brain-graph-3d-wrap">
      <div className="brain-graph-3d" ref={containerRef} />
      <div className={`brain-labels ${look.light ? 'is-light' : ''}`} ref={labelsRef} aria-hidden="true" />
    </div>
  )
}

export default BrainGraph3D


