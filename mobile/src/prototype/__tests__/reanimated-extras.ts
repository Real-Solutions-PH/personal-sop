// Pieces of the Reanimated API the hand-written test mocks need beyond
// shared values: easing, layout animation builders and animated props.
const chain: object = new Proxy(() => chain, { get: () => () => chain })
const id = (x: unknown) => x
export const extras = {
  Easing: { out: id, in: id, inOut: id, cubic: id, linear: id },
  FadeIn: chain,
  FadeOut: chain,
  FadeInDown: chain,
  FadeInUp: chain,
  SlideInLeft: chain,
  SlideInRight: chain,
  ZoomIn: chain,
  LinearTransition: chain,
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
  useAnimatedProps: (get: () => unknown) => get(),
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withDelay: (_: number, value: unknown) => value,
  withRepeat: id,
  cancelAnimation: () => {},
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: id,
}
