// Ambient module declarations for the Bare worker artifacts and the generated
// HRPC contract. The worker bundle is plain JS (bare-pack consumes it directly
// on the Bare side); the HRPC client in core's `spec/hrpc/index.js` is untyped
// generated JS that core keeps out of its TypeScript build. Declarations live
// here so TypeScript can type the Hermes-side imports.

declare module "*/worker.bundle.cjs" {
  // bare-pack's `bundle.cjs` format is `module.exports = <stringified bundle>`.
  // Metro resolves .cjs at runtime; this default export is the bundle string
  // that Worklet.start() takes as `source`.
  const bundle: string
  export default bundle
}
